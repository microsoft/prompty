import {
	IConnectionProvider,
	ConnectionProviderType,
	ConnectionProfile,
	ConnectionField,
	ConnectionTestResult,
	FoundryConnectionProfile,
} from "../types";

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
				key: "connectionType",
				label: "Connection Type",
				placeholder: "e.g., model, index, storage",
				required: false,
			},
		];
	}

	async testConnection(
		profile: ConnectionProfile
	): Promise<ConnectionTestResult> {
		const p = profile as FoundryConnectionProfile;

		try {
			const { AIProjectClient } = await import("@azure/ai-projects");
			const { DefaultAzureCredential } = await import(
				"@azure/identity"
			);

			const credential = new DefaultAzureCredential();
			const projectClient = new AIProjectClient(
				p.endpoint,
				credential
			);

			const start = Date.now();
			// Use a lightweight chat completion to verify the connection
			const openAIClient = projectClient.getOpenAIClient();
			// Try listing models first; if that 404s, try a simple completion
			try {
				await openAIClient.models.list();
			} catch {
				// models.list() may not be available on all Foundry endpoints
				// Just verify we can create the client without error
				await openAIClient.chat.completions.create({
					model: "gpt-4o-mini",
					messages: [{ role: "user", content: "hi" }],
					max_tokens: 1,
				});
			}
			const latencyMs = Date.now() - start;

			return {
				success: true,
				message: `Connected to Foundry project (${latencyMs}ms)`,
				latencyMs,
			};
		} catch (error: unknown) {
			const message =
				error instanceof Error ? error.message : String(error);

			if (
				message.includes("Cannot find module") ||
				message.includes("@azure/ai-projects")
			) {
				return {
					success: false,
					message:
						"@azure/ai-projects not installed. Run: npm install @azure/ai-projects @azure/identity",
				};
			}

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

	async createClient(profile: ConnectionProfile): Promise<unknown> {
		const p = profile as FoundryConnectionProfile;

		const { AIProjectClient } = await import("@azure/ai-projects");
		const { DefaultAzureCredential } = await import("@azure/identity");

		const credential = new DefaultAzureCredential();
		const projectClient = new AIProjectClient(p.endpoint, credential);

		// Return the OpenAI-compatible client for model access
		return projectClient.getOpenAIClient();
	}
}
