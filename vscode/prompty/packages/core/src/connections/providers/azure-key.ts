import {
	IConnectionProvider,
	ConnectionProviderType,
	ConnectionProfile,
	AzureKeyConnectionProfile,
	ConnectionField,
	ConnectionTestResult,
} from "../types";

export class AzureKeyConnectionProvider implements IConnectionProvider {
	readonly id = "azure-key";
	readonly label = "Azure OpenAI (API Key)";
	readonly iconId = "azure";
	readonly providerTypes: ConnectionProviderType[] = ["azure-openai"];

	getConfigurationFields(): ConnectionField[] {
		return [
			{
				key: "name",
				label: "Connection Name",
				placeholder: "e.g., My Azure OpenAI",
				required: true,
			},
			{
				key: "endpoint",
				label: "Endpoint",
				placeholder: "https://{resource}.openai.azure.com/",
				required: true,
				validationPattern: "^https://",
				validationMessage: "Endpoint must start with https://",
			},
			{
				key: "apiKey",
				label: "API Key",
				placeholder: "Enter your Azure OpenAI API key",
				required: true,
				isSecret: true,
			},
			{
				key: "deployment",
				label: "Default Deployment",
				placeholder: "gpt-4o",
				required: false,
			},
			{
				key: "apiVersion",
				label: "API Version",
				placeholder: "2024-10-21",
				required: false,
				defaultValue: "2024-10-21",
			},
		];
	}

	async testConnection(
		profile: ConnectionProfile,
		secret?: string
	): Promise<ConnectionTestResult> {
		const p = profile as AzureKeyConnectionProfile;
		if (!secret) {
			return { success: false, message: "API key is required" };
		}

		try {
			const { AzureOpenAI } = await import("openai");
			const client = new AzureOpenAI({
				apiKey: secret,
				endpoint: p.endpoint,
				apiVersion: p.apiVersion ?? "2024-10-21",
			});

			const start = Date.now();
			// Simple connectivity check — list models
			await client.models.list();
			const latencyMs = Date.now() - start;

			return {
				success: true,
				message: `Connected to ${p.endpoint} (${latencyMs}ms)`,
				latencyMs,
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
		const p = profile as AzureKeyConnectionProfile;
		if (!secret) {
			throw new Error("API key is required for Azure OpenAI connections");
		}

		const { AzureOpenAI } = await import("openai");
		return new AzureOpenAI({
			apiKey: secret,
			endpoint: p.endpoint,
			apiVersion: p.apiVersion ?? "2024-10-21",
		});
	}
}
