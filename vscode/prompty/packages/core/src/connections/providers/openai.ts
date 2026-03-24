import {
	IConnectionProvider,
	ConnectionProviderType,
	ConnectionProfile,
	OpenAIConnectionProfile,
	ConnectionField,
	ConnectionTestResult,
} from "../types";

export class OpenAIConnectionProvider implements IConnectionProvider {
	readonly id = "openai";
	readonly label = "OpenAI";
	readonly iconId = "sparkle";
	readonly providerTypes: ConnectionProviderType[] = ["openai"];

	getConfigurationFields(): ConnectionField[] {
		return [
			{
				key: "name",
				label: "Connection Name",
				placeholder: "e.g., My OpenAI",
				required: true,
			},
			{
				key: "apiKey",
				label: "API Key",
				placeholder: "sk-...",
				required: true,
				isSecret: true,
			},
			{
				key: "endpoint",
				label: "Endpoint",
				placeholder: "https://api.openai.com/v1",
				required: false,
				defaultValue: "https://api.openai.com/v1",
			},
			{
				key: "model",
				label: "Default Model",
				placeholder: "gpt-4o",
				required: false,
				defaultValue: "gpt-4o",
			},
		];
	}

	async testConnection(
		profile: ConnectionProfile,
		secret?: string
	): Promise<ConnectionTestResult> {
		const p = profile as OpenAIConnectionProfile;
		if (!secret) {
			return { success: false, message: "API key is required" };
		}

		try {
			const { default: OpenAI } = await import("openai");
			const client = new OpenAI({
				apiKey: secret,
				baseURL: p.endpoint,
			});

			const start = Date.now();
			await client.models.list();
			const latencyMs = Date.now() - start;

			return {
				success: true,
				message: `Connected successfully (${latencyMs}ms)`,
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
		const p = profile as OpenAIConnectionProfile;
		if (!secret) {
			throw new Error("API key is required for OpenAI connections");
		}

		const { default: OpenAI } = await import("openai");
		return new OpenAI({
			apiKey: secret,
			baseURL: p.endpoint,
		});
	}
}
