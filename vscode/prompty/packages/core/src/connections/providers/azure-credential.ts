import {
	IConnectionProvider,
	ConnectionProviderType,
	ConnectionProfile,
	AzureCredentialConnectionProfile,
	ConnectionField,
	ConnectionTestResult,
} from "../types";

export class AzureCredentialConnectionProvider implements IConnectionProvider {
	readonly id = "azure-credential";
	readonly label = "Azure OpenAI (Default Credential)";
	readonly iconId = "shield";
	readonly providerTypes: ConnectionProviderType[] = ["azure-openai"];

	getConfigurationFields(): ConnectionField[] {
		return [
			{
				key: "name",
				label: "Connection Name",
				placeholder: "e.g., Azure Default Credential",
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
		profile: ConnectionProfile
	): Promise<ConnectionTestResult> {
		const p = profile as AzureCredentialConnectionProfile;

		try {
			const { DefaultAzureCredential } = await import(
				"@azure/identity"
			);
			const { AzureOpenAI } = await import("openai");

			const credential = new DefaultAzureCredential();
			const client = new AzureOpenAI({
				azureADTokenProvider: async () => {
					const token = await credential.getToken(
						"https://cognitiveservices.azure.com/.default"
					);
					return token.token;
				},
				endpoint: p.endpoint,
				apiVersion: p.apiVersion ?? "2024-10-21",
			});

			const start = Date.now();
			await client.models.list();
			const latencyMs = Date.now() - start;

			return {
				success: true,
				message: `Connected via Azure credential (${latencyMs}ms)`,
				latencyMs,
			};
		} catch (error: unknown) {
			const message =
				error instanceof Error ? error.message : String(error);

			if (
				message.includes("Cannot find module") ||
				message.includes("@azure/identity")
			) {
				return {
					success: false,
					message:
						'@azure/identity not installed. Run: npm install @azure/identity',
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

			return { success: false, message: `Connection failed: ${message}` };
		}
	}

	async createClient(profile: ConnectionProfile): Promise<unknown> {
		const p = profile as AzureCredentialConnectionProfile;

		const { DefaultAzureCredential } = await import("@azure/identity");
		const { AzureOpenAI } = await import("openai");

		const credential = new DefaultAzureCredential();
		return new AzureOpenAI({
			azureADTokenProvider: async () => {
				const token = await credential.getToken(
					"https://cognitiveservices.azure.com/.default"
				);
				return token.token;
			},
			endpoint: p.endpoint,
			apiVersion: p.apiVersion ?? "2024-10-21",
		});
	}
}
