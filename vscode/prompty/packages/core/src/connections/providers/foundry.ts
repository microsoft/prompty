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
		];
	}

	/** Get a bearer token via DefaultAzureCredential for the Azure AI Foundry scope */
	private async getBearerToken(): Promise<string> {
		const { DefaultAzureCredential } = await import("@azure/identity");
		const credential = new DefaultAzureCredential();
		const tokenResponse = await credential.getToken(
			"https://ai.azure.com/.default"
		);
		return tokenResponse.token;
	}

	async testConnection(
		profile: ConnectionProfile
	): Promise<ConnectionTestResult> {
		const p = profile as FoundryConnectionProfile;

		try {
			const token = await this.getBearerToken();
			const endpoint = p.endpoint.replace(/\/$/, "");
			const url = `${endpoint}/deployments?api-version=v1`;

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
				return {
					success: false,
					message: `${response.status}: ${body.slice(0, 200)}`,
				};
			}

			const data = (await response.json()) as FoundryDeploymentsResponse;
			const count = data.value?.length ?? 0;

			return {
				success: true,
				message: `Connected — ${count} deployment${count !== 1 ? "s" : ""} available (${latencyMs}ms)`,
				latencyMs,
			};
		} catch (error: unknown) {
			const message =
				error instanceof Error ? error.message : String(error);

			if (
				message.includes("CredentialUnavailableError") ||
				message.includes("DefaultAzureCredential")
			) {
				return {
					success: false,
					message:
						"No Azure credentials found. Sign in via: az login, VS Code Azure account, or set environment variables.",
				};
			}

			return {
				success: false,
				message: `Connection failed: ${message}`,
			};
		}
	}

	async listModels(profile: ConnectionProfile): Promise<ModelInfo[]> {
		const p = profile as FoundryConnectionProfile;

		const token = await this.getBearerToken();
		const endpoint = p.endpoint.replace(/\/$/, "");
		const url = `${endpoint}/deployments?api-version=v1`;

		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(`Failed to list models: ${response.status} ${body.slice(0, 200)}`);
		}

		const data = (await response.json()) as FoundryDeploymentsResponse;
		return (data.value ?? []).map((d) => ({
			id: d.name,
			modelName: d.properties?.model?.name,
		}));
	}

	async createClient(profile: ConnectionProfile): Promise<unknown> {
		const p = profile as FoundryConnectionProfile;

		const { AIProjectClient } = await import("@azure/ai-projects");
		const { DefaultAzureCredential } = await import("@azure/identity");

		const credential = new DefaultAzureCredential();
		const projectClient = new AIProjectClient(p.endpoint, credential);

		return projectClient.getOpenAIClient();
	}
}
