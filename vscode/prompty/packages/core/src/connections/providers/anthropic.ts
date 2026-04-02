import {
	IConnectionProvider,
	ConnectionProviderType,
	ConnectionProfile,
	AnthropicConnectionProfile,
	ConnectionField,
	ConnectionTestResult,
	ModelInfo,
} from "../types";

/**
 * Anthropic provider — uses the OpenAI-compatible API via the openai SDK.
 * Anthropic provides an OpenAI-compatible endpoint, so we use the same
 * OpenAI client with a different base URL and API key header.
 */
export class AnthropicConnectionProvider implements IConnectionProvider {
	readonly id = "anthropic";
	readonly label = "Anthropic";
	readonly iconId = "hubot";
	readonly providerTypes: ConnectionProviderType[] = ["anthropic"];

	getConfigurationFields(): ConnectionField[] {
		return [
			{
				key: "name",
				label: "Connection Name",
				placeholder: "e.g., My Anthropic",
				required: true,
			},
			{
				key: "apiKey",
				label: "API Key",
				placeholder: "sk-ant-...",
				required: true,
				isSecret: true,
			},
			{
				key: "endpoint",
				label: "Endpoint",
				placeholder: "https://api.anthropic.com",
				required: false,
				defaultValue: "https://api.anthropic.com",
			},
			{
				key: "model",
				label: "Default Model",
				placeholder: "claude-sonnet-4-6",
				required: false,
				defaultValue: "claude-sonnet-4-6",
			},
		];
	}

	async testConnection(
		profile: ConnectionProfile,
		secret?: string
	): Promise<ConnectionTestResult> {
		if (!secret) {
			return { success: false, message: "API key is required" };
		}

		const p = profile as AnthropicConnectionProfile;

		try {
			const endpoint = p.endpoint ?? "https://api.anthropic.com";
			const start = Date.now();

			const response = await fetch(`${endpoint}/v1/messages`, {
				method: "POST",
				headers: {
					"x-api-key": secret,
					"anthropic-version": "2023-06-01",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					model: p.model ?? "claude-sonnet-4-6",
					max_tokens: 1,
					messages: [{ role: "user", content: "hi" }],
				}),
			});

			const latencyMs = Date.now() - start;

			if (response.ok || response.status === 200) {
				return {
					success: true,
					message: `Connected to Anthropic (${latencyMs}ms)`,
					latencyMs,
				};
			}

			const body = await response.text();
			return {
				success: false,
				message: `API returned ${response.status}: ${body.slice(0, 200)}`,
			};
		} catch (error: unknown) {
			const message =
				error instanceof Error ? error.message : String(error);
			return { success: false, message: `Connection failed: ${message}` };
		}
	}

	async createClient(
		profile: ConnectionProfile,
		secret?: string
	): Promise<unknown> {
		if (!secret) {
			throw new Error("API key is required for Anthropic connections");
		}

		const p = profile as AnthropicConnectionProfile;
		const AnthropicSDK = (await import("@anthropic-ai/sdk")).default;
		return new AnthropicSDK({
			apiKey: secret,
			baseURL: p.endpoint ?? "https://api.anthropic.com",
		});
	}

	async listModels(
		profile: ConnectionProfile,
		secret?: string
	): Promise<ModelInfo[] | undefined> {
		if (!secret) return undefined;

		const p = profile as AnthropicConnectionProfile;
		const endpoint = p.endpoint ?? "https://api.anthropic.com";

		try {
			const response = await fetch(`${endpoint}/v1/models?limit=100`, {
				headers: {
					"x-api-key": secret,
					"anthropic-version": "2023-06-01",
				},
			});

			if (!response.ok) return undefined;

			const body = await response.json() as {
				data?: Array<{ id: string; display_name?: string }>;
			};

			if (!body.data) return undefined;

			return body.data
				.map((m) => ({
					id: m.id,
					ownedBy: m.display_name ?? "anthropic",
				}))
				.sort((a, b) => a.id.localeCompare(b.id));
		} catch {
			return undefined;
		}
	}
}
