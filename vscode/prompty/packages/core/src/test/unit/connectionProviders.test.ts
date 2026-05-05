import * as assert from "assert";

import {
	ApiKeyConnection,
	clearConnections,
	Connection,
	getConnection,
	ModelInfo as RuntimeModelInfo,
	ReferenceConnection,
} from "@prompty/core";
import * as openai from "openai";

import { FoundryConnectionProvider } from "../../connections/providers/foundry";
import { OpenAIConnectionProvider } from "../../connections/providers/openai";
import type { FoundryConnectionProfile, OpenAIConnectionProfile } from "../../connections/types";

class TestFoundryConnectionProvider extends FoundryConnectionProvider {
	constructor(
		listRuntimeAzureModels: ConstructorParameters<typeof FoundryConnectionProvider>[0],
		private readonly tokenResult: string | Error = "test-token"
	) {
		super(listRuntimeAzureModels);
	}

	protected override async getBearerToken(): Promise<{ token: string; source: string }> {
		if (this.tokenResult instanceof Error) {
			throw this.tokenResult;
		}
		return { token: this.tokenResult, source: "TestCredential" };
	}
}

suite("Connection provider model discovery", () => {
	const originalOpenAIBaseUrl = process.env.OPENAI_BASE_URL;
	const originalAzureOpenAIApiKey = process.env.AZURE_OPENAI_API_KEY;
	const originalAzureOpenAI = openai.AzureOpenAI;
	const originalOpenAI = openai.OpenAI;

	teardown(() => {
		clearConnections();
		if (originalOpenAIBaseUrl === undefined) {
			delete process.env.OPENAI_BASE_URL;
		} else {
			process.env.OPENAI_BASE_URL = originalOpenAIBaseUrl;
		}
		if (originalAzureOpenAIApiKey === undefined) {
			delete process.env.AZURE_OPENAI_API_KEY;
		} else {
			process.env.AZURE_OPENAI_API_KEY = originalAzureOpenAIApiKey;
		}
		Object.defineProperty(openai, "AzureOpenAI", {
			configurable: true,
			writable: true,
			value: originalAzureOpenAI,
		});
		Object.defineProperty(openai, "OpenAI", {
			configurable: true,
			writable: true,
			value: originalOpenAI,
		});
	});

	test("OpenAI provider delegates model discovery to @prompty/openai", async () => {
		let capturedConnection: Connection | undefined;
		const provider = new OpenAIConnectionProvider(async (connection: Connection) => {
			capturedConnection = connection;
			return [
				new RuntimeModelInfo({
					id: "z-model",
					displayName: "Zed",
					ownedBy: "openai",
					contextWindow: 128000,
					inputModalities: ["text", "image"],
					outputModalities: ["text"],
				}),
				new RuntimeModelInfo({
					id: "a-model",
					displayName: "Alpha",
					ownedBy: "openai",
				}),
			];
		});

		const profile: OpenAIConnectionProfile = {
			id: "openai-test",
			name: "OpenAI Test",
			providerType: "openai",
			authType: "key",
			endpoint: "https://api.openai.test/v1",
		};

		const models = await provider.listModels(profile, "test-key");

		assert.ok(capturedConnection instanceof ApiKeyConnection);
		assert.equal((capturedConnection as ApiKeyConnection).apiKey, "test-key");
		assert.equal((capturedConnection as ApiKeyConnection).endpoint, "https://api.openai.test/v1");
		assert.deepEqual(models, [
			{
				id: "a-model",
				modelName: "Alpha",
				ownedBy: "openai",
				capabilities: {},
			},
			{
				id: "z-model",
				modelName: "Zed",
				ownedBy: "openai",
				capabilities: {
					contextWindow: "128000",
					inputModalities: "text, image",
					outputModalities: "text",
				},
			},
		]);
	});

	test("OpenAI provider skips model discovery without a secret", async () => {
		let called = false;
		const provider = new OpenAIConnectionProvider(async () => {
			called = true;
			return [];
		});

		const profile: OpenAIConnectionProfile = {
			id: "openai-test",
			name: "OpenAI Test",
			providerType: "openai",
			authType: "key",
		};

		const models = await provider.listModels(profile);

		assert.equal(models, undefined);
		assert.equal(called, false);
	});

	test("OpenAI provider returns undefined when runtime model discovery fails", async () => {
		const provider = new OpenAIConnectionProvider(async () => {
			throw new Error("OpenAI unavailable");
		});
		const profile: OpenAIConnectionProfile = {
			id: "openai-test",
			name: "OpenAI Test",
			providerType: "openai",
			authType: "key",
		};

		const models = await provider.listModels(profile, "test-key");

		assert.equal(models, undefined);
	});

	test("Foundry provider registers a runtime connection and delegates to @prompty/foundry", async () => {
		let capturedConnection: Connection | undefined;
		const provider = new TestFoundryConnectionProvider(async (connection: Connection) => {
			capturedConnection = connection;
			const registered = getConnection((connection as ReferenceConnection).name) as {
				projectEndpoint: string;
				getToken: () => Promise<string>;
			};
			assert.equal(registered.projectEndpoint, "https://example.services.ai.azure.com/api/projects/test");
			assert.equal(await registered.getToken(), "test-token");
			return [
				new RuntimeModelInfo({
					id: "deployment-a",
					displayName: "gpt-4o",
					ownedBy: "azure",
					contextWindow: 128000,
					inputModalities: ["text"],
					outputModalities: ["text", "json"],
				}),
			];
		});

		const profile: FoundryConnectionProfile = {
			id: "foundry-test",
			name: "Foundry Test",
			providerType: "foundry",
			authType: "foundry",
			endpoint: "https://example.services.ai.azure.com/api/projects/test/",
			tenantId: "tenant-id",
			connectionType: "model",
		};

		const models = await provider.listModels(profile);

		assert.ok(capturedConnection instanceof ReferenceConnection);
		assert.equal((capturedConnection as ReferenceConnection).name, "vscode-foundry-models-foundry-test");
		assert.deepEqual(models, [
			{
				id: "deployment-a",
				modelName: "gpt-4o",
				ownedBy: "azure",
				capabilities: {
					contextWindow: "128000",
					inputModalities: "text",
					outputModalities: "text, json",
				},
			},
		]);
	});

	test("Foundry provider adds context when auth fails during runtime model discovery", async () => {
		const provider = new TestFoundryConnectionProvider(async (connection: Connection) => {
			const registered = getConnection((connection as ReferenceConnection).name) as {
				getToken: () => Promise<string>;
			};
			await registered.getToken();
			return [];
		}, new Error("Invalid tenant"));
		const profile: FoundryConnectionProfile = {
			id: "foundry-test",
			name: "Foundry Test",
			providerType: "foundry",
			authType: "foundry",
			endpoint: "https://example.services.ai.azure.com/api/projects/test/",
			connectionType: "model",
		};

		await assert.rejects(
			provider.listModels(profile),
			/Failed to list Foundry models for "Foundry Test": Failed to authenticate for Foundry model discovery for "Foundry Test": Invalid tenant/
		);
	});

	test("Foundry provider adds context when runtime model discovery fails", async () => {
		const provider = new TestFoundryConnectionProvider(async () => {
			throw new Error("Azure list failed");
		});
		const profile: FoundryConnectionProfile = {
			id: "foundry-test",
			name: "Foundry Test",
			providerType: "foundry",
			authType: "foundry",
			endpoint: "https://example.services.ai.azure.com/api/projects/test/",
			connectionType: "model",
		};

		await assert.rejects(
			provider.listModels(profile),
			/Failed to list Foundry models for "Foundry Test": Azure list failed/
		);
	});

	test("Foundry client creation ignores and restores conflicting OpenAI SDK env vars", async () => {
		process.env.OPENAI_BASE_URL = "https://openai-proxy.example/v1";
		process.env.AZURE_OPENAI_API_KEY = "azure-api-key";
		let sawOpenAIBaseUrlDuringConstruction = true;
		let sawAzureApiKeyDuringConstruction = true;
		let capturedBaseURL: string | undefined;
		Object.defineProperty(openai, "OpenAI", {
			configurable: true,
			writable: true,
			value: class {
				constructor(options: { baseURL?: string }) {
					capturedBaseURL = options.baseURL;
					sawOpenAIBaseUrlDuringConstruction = process.env.OPENAI_BASE_URL !== undefined;
					sawAzureApiKeyDuringConstruction = process.env.AZURE_OPENAI_API_KEY !== undefined;
				}
			},
		});

		const provider = new FoundryConnectionProvider();
		const profile: FoundryConnectionProfile = {
			id: "foundry-test",
			name: "Foundry Test",
			providerType: "foundry",
			authType: "foundry",
			endpoint: "https://example.services.ai.azure.com/api/projects/test/",
			connectionType: "model",
		};

		await provider.createClient(profile);

		assert.equal(capturedBaseURL, "https://example.openai.azure.com/openai/v1");
		assert.equal(sawOpenAIBaseUrlDuringConstruction, false);
		assert.equal(sawAzureApiKeyDuringConstruction, false);
		assert.equal(process.env.OPENAI_BASE_URL, "https://openai-proxy.example/v1");
		assert.equal(process.env.AZURE_OPENAI_API_KEY, "azure-api-key");
	});
});
