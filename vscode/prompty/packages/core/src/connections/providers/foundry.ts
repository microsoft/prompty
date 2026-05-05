import type {
	IConnectionProvider,
	ConnectionProviderType,
	ConnectionProfile,
	ConnectionField,
	ConnectionTestResult,
	FoundryConnectionProfile,
	ModelInfo,
} from "../types";
import { ReferenceConnection, registerConnection } from "@prompty/core";
import { listAzureModels } from "@prompty/foundry";

type AzureModelLister = typeof listAzureModels;
type RuntimeConnectionRegistrar = typeof registerConnection;
interface FoundryDeploymentDiscoveryClient {
	projectEndpoint: string;
	getToken: () => Promise<string>;
}

/** Foundry project deployments API response */
interface FoundryDeployment {
	name: string;
	properties?: {
		model?: { name: string };
	};
}

interface FoundryDeploymentsResponse {
	value: FoundryDeployment[];
}

function toOpenAIBaseURL(projectEndpoint: string): string {
	const url = new URL(projectEndpoint);
	const servicesSuffix = ".services.ai.azure.com";
	let hostname = url.hostname;
	if (hostname.endsWith(servicesSuffix)) {
		hostname = `${hostname.slice(0, -servicesSuffix.length)}.openai.azure.com`;
	}
	return `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ""}/openai/v1`;
}

export class FoundryConnectionProvider implements IConnectionProvider {
	readonly id = "foundry";
	readonly label = "Microsoft Foundry";
	readonly iconId = "azure";
	readonly providerTypes: ConnectionProviderType[] = ["foundry"];

	constructor(
		private readonly listRuntimeAzureModels: AzureModelLister = listAzureModels,
		private readonly registerRuntimeConnection: RuntimeConnectionRegistrar = registerConnection
	) {}

	getConfigurationFields(): ConnectionField[] {
		return [
			{
				key: "name",
				label: "Connection Name",
				placeholder: "e.g., My Foundry Project",
				required: true,
			},
			{
				key: "endpoint",
				label: "Project Endpoint",
				placeholder:
					"https://myresource.services.ai.azure.com/api/projects/myproject",
				required: true,
				validationPattern: "^https://",
				validationMessage: "Endpoint must start with https://",
			},
			{
				key: "connectionName",
				label: "Connection Name (in project)",
				placeholder: "Optional — named connection within the project",
				required: false,
			},
			{
				key: "tenantId",
				label: "Tenant ID",
				placeholder: "Optional — Azure AD tenant ID if resource is in a different tenant",
				required: false,
			},
		];
	}

	/** Scope used for Azure AI Foundry bearer tokens */
	private static readonly TOKEN_SCOPE = "https://ai.azure.com/.default";

	/**
	 * Get a bearer token via DefaultAzureCredential.
	 * Returns both the token and which credential source succeeded for diagnostics.
	 */
	protected async getBearerToken(tenantId?: string): Promise<{ token: string; source: string }> {
		const { DefaultAzureCredential } = await import("@azure/identity");
		const credentialOptions = tenantId ? { tenantId } : undefined;
		const credential = new DefaultAzureCredential(credentialOptions);

		try {
			const tokenResponse = await credential.getToken(
				FoundryConnectionProvider.TOKEN_SCOPE,
				tenantId ? { tenantId } : undefined
			);

			// Detect which credential source was used
			let source = "DefaultAzureCredential";
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Azure SDK internals
			const credAny = credential as Record<string, any>;
			const credType = credAny._selectedCredential?.constructor?.name
				?? credAny.selectedCredential?.constructor?.name;
			if (credType) {
				source = credType;
			}

			return { token: tokenResponse.token, source };
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);

			// Provide a clear diagnostic about what was tried
			if (msg.includes("CredentialUnavailableError") || msg.includes("DefaultAzureCredential")) {
				throw new Error(
					`No Azure credentials found (scope: ${FoundryConnectionProvider.TOKEN_SCOPE}). ` +
					`Tried: EnvironmentCredential, AzureCliCredential, AzurePowerShellCredential, VisualStudioCodeCredential. ` +
					`Sign in via: az login, VS Code Azure account, or set AZURE_CLIENT_ID + AZURE_TENANT_ID + AZURE_CLIENT_SECRET`
				);
			}
			throw new Error(`Azure credential error: ${msg}`);
		}
	}

	async testConnection(
		profile: ConnectionProfile
	): Promise<ConnectionTestResult> {
		const p = profile as FoundryConnectionProfile;

		try {
			const { token, source } = await this.getBearerToken(p.tenantId);
			const endpoint = p.endpoint.replace(/\/$/, "");
			const url = `${endpoint}/deployments?api-version=v1`;

			console.log(`[Foundry] Testing "${p.name}" — credential: ${source}, endpoint: ${endpoint}`);

			const start = Date.now();
			const response = await fetch(url, {
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
			});
			const latencyMs = Date.now() - start;

			if (!response.ok) {
				const body = await response.text();
				console.warn(`[Foundry] Test failed for "${p.name}": ${response.status} ${body.slice(0, 300)}`);
				return {
					success: false,
					message: `${response.status}: ${body.slice(0, 200)}`,
				};
			}

			const data = (await response.json()) as FoundryDeploymentsResponse;
			const count = data.value?.length ?? 0;

			console.log(`[Foundry] Test OK for "${p.name}": ${count} deployments (${source}, ${latencyMs}ms)`);

			return {
				success: true,
				message: `Connected — ${count} deployment${count !== 1 ? "s" : ""} available · ${source} (${latencyMs}ms)`,
				latencyMs,
			};
		} catch (error: unknown) {
			const message =
				error instanceof Error ? error.message : String(error);
			console.error(`[Foundry] Test error for "${p.name}": ${message}`);

			return {
				success: false,
				message: `Connection failed: ${message}`,
			};
		}
	}

	async listModels(profile: ConnectionProfile): Promise<ModelInfo[]> {
		const p = profile as FoundryConnectionProfile;
		const endpoint = p.endpoint.replace(/\/$/, "");

		console.log(`[Foundry] Listing models for "${p.name}" — ${endpoint}/deployments`);

		const connectionName = `vscode-foundry-models-${p.id}`;
		const discoveryClient: FoundryDeploymentDiscoveryClient = {
			projectEndpoint: endpoint,
			getToken: async () => {
				try {
					const result = await this.getBearerToken(p.tenantId);
					return result.token;
				} catch (error: unknown) {
					const message = error instanceof Error ? error.message : String(error);
					console.error(`[Foundry] Auth failed for "${p.name}": ${message}`);
					throw new Error(`Failed to authenticate for Foundry model discovery for "${p.name}": ${message}`);
				}
			},
		};
		this.registerRuntimeConnection(connectionName, discoveryClient);

		try {
			const models = (await this.listRuntimeAzureModels(new ReferenceConnection({ name: connectionName }))).map((model) => ({
				id: model.id,
				modelName: model.displayName,
				ownedBy: model.ownedBy,
				capabilities: {
					...(model.contextWindow !== undefined ? { contextWindow: String(model.contextWindow) } : {}),
					...(model.inputModalities && model.inputModalities.length > 0 ? { inputModalities: model.inputModalities.join(", ") } : {}),
					...(model.outputModalities && model.outputModalities.length > 0 ? { outputModalities: model.outputModalities.join(", ") } : {}),
				},
			}));

			console.log(`[Foundry] Found ${models.length} models for "${p.name}": ${models.map(m => m.id).join(", ")}`);
			return models;
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[Foundry] Model listing failed for "${p.name}": ${message}`);
			throw new Error(`Failed to list Foundry models for "${p.name}": ${message}`);
		}
	}

	async createClient(profile: ConnectionProfile): Promise<unknown> {
		const p = profile as FoundryConnectionProfile;

		const baseURL = toOpenAIBaseURL(p.endpoint);
		const { OpenAI } = await import("openai");
		const savedBaseUrl = process.env.OPENAI_BASE_URL;
		const savedAzureApiKey = process.env.AZURE_OPENAI_API_KEY;
		delete process.env.OPENAI_BASE_URL;
		delete process.env.AZURE_OPENAI_API_KEY;
		let client: unknown;
		try {
			client = new OpenAI({
				baseURL,
				apiKey: "unused",
				fetch: async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): ReturnType<typeof fetch> => {
					const result = await this.getBearerToken(p.tenantId);
					const headers = new Headers(init?.headers);
					headers.set("Authorization", `Bearer ${result.token}`);
					return fetch(url, { ...init, headers });
				},
			});
		} finally {
			if (savedBaseUrl !== undefined) {
				process.env.OPENAI_BASE_URL = savedBaseUrl;
			}
			if (savedAzureApiKey !== undefined) {
				process.env.AZURE_OPENAI_API_KEY = savedAzureApiKey;
			}
		}

		console.log(`[Foundry] Client for "${p.name}": baseURL=${baseURL}`);

		return client;
	}
}
