import {
	IConnectionProvider,
	ConnectionProviderType,
	ConnectionProfile,
	ConnectionField,
	ConnectionTestResult,
	FoundryConnectionProfile,
	ModelInfo,
} from "../types";

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

export class FoundryConnectionProvider implements IConnectionProvider {
	readonly id = "foundry";
	readonly label = "Microsoft Foundry";
	readonly iconId = "azure";
	readonly providerTypes: ConnectionProviderType[] = ["foundry"];

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
	private async getBearerToken(tenantId?: string): Promise<{ token: string; source: string }> {
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
			const credType = (credential as any)._selectedCredential?.constructor?.name
				?? (credential as any).selectedCredential?.constructor?.name;
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
		const url = `${endpoint}/deployments?api-version=v1`;

		console.log(`[Foundry] Listing models for "${p.name}" — ${endpoint}/deployments`);

		let source: string;
		let token: string;
		try {
			const result = await this.getBearerToken(p.tenantId);
			token = result.token;
			source = result.source;
			console.log(`[Foundry] Authenticated via ${source}`);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[Foundry] Auth failed for "${p.name}": ${msg}`);
			throw err;
		}

		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
		});

		if (!response.ok) {
			const body = await response.text();
			const detail = `${response.status} ${response.statusText} — ${body.slice(0, 300)}`;
			console.error(`[Foundry] Model list failed for "${p.name}" (${source}): ${detail}`);

			// Detect tenant mismatch and give a clear hint
			if (body.includes("tenant") && body.includes("does not match")) {
				throw new Error(
					`Tenant mismatch for "${p.name}": your credential is in a different tenant than the Foundry resource. ` +
					`Edit the connection and set the Tenant ID field, or run: az login --tenant <correct-tenant-id>`
				);
			}

			throw new Error(`Failed to list models (${source}): ${detail}`);
		}

		const data = (await response.json()) as FoundryDeploymentsResponse;
		const models = (data.value ?? []).map((d) => ({
			id: d.name,
			modelName: d.properties?.model?.name,
		}));

		console.log(`[Foundry] Found ${models.length} models for "${p.name}": ${models.map(m => m.id).join(", ")}`);
		return models;
	}

	async createClient(profile: ConnectionProfile): Promise<unknown> {
		const p = profile as FoundryConnectionProfile;

		const { DefaultAzureCredential, getBearerTokenProvider } = await import("@azure/identity");

		const credentialOptions = p.tenantId ? { tenantId: p.tenantId } : undefined;
		const credential = new DefaultAzureCredential(credentialOptions);

		// Extract the resource base endpoint from the project endpoint
		// e.g. "https://foo.services.ai.azure.com/api/projects/bar" → "https://foo.services.ai.azure.com"
		const url = new URL(p.endpoint);
		const resourceEndpoint = `${url.protocol}//${url.host}`;

		const scope = "https://cognitiveservices.azure.com/.default";
		const azureADTokenProvider = getBearerTokenProvider(credential, scope);

		const { AzureOpenAI } = await import("openai");
		const client = new AzureOpenAI({
			endpoint: resourceEndpoint,
			azureADTokenProvider,
			apiVersion: "2025-04-01-preview",
		});

		console.log(`[Foundry] Client for "${p.name}": endpoint=${resourceEndpoint}, apiVersion=2025-04-01-preview`);

		return client;
	}
}
