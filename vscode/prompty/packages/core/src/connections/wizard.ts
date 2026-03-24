import * as vscode from "vscode";
import { ConnectionStore } from "./store";
import { ConnectionProviderRegistry } from "./registry";
import {
	ConnectionProfile,
	ConnectionField,
	ConnectionProviderType,
} from "./types";

/**
 * Interactive wizard for creating/editing connections.
 * Uses VSCode QuickPick and InputBox for a step-by-step flow.
 */
export class ConnectionWizard {
	constructor(
		private readonly store: ConnectionStore,
		private readonly registry: ConnectionProviderRegistry,
		private readonly extensionPath?: string
	) {}

	/**
	 * Run the "Add Connection" wizard.
	 * @returns The created profile, or undefined if cancelled.
	 */
	async addConnection(): Promise<ConnectionProfile | undefined> {
		// Step 1: Pick provider
		const providerChoice = await this.pickProvider();
		if (!providerChoice) return undefined;

		const { provider, providerType } = providerChoice;
		const fields = provider.getConfigurationFields(providerType);

		// Step 2: Collect fields
		const values = await this.collectFields(fields);
		if (!values) return undefined;

		// Step 3: Build profile
		const id = `${providerType}-${Date.now()}`;
		const profile = this.buildProfile(id, providerType, values, fields);

		// Step 4: Store secret if applicable
		const secretField = fields.find((f) => f.isSecret);
		if (secretField && values[secretField.key]) {
			await this.store.setSecret(id, values[secretField.key]);
		}

		// Step 5: Save profile (without secret fields)
		await this.store.saveProfile(profile);

		// Step 6: Optionally test
		const testNow = await vscode.window.showInformationMessage(
			`Connection "${profile.name}" saved. Test it now?`,
			"Test",
			"Later"
		);

		if (testNow === "Test") {
			const secret = secretField
				? await this.store.getSecret(id)
				: undefined;
			const result = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Testing connection...",
				},
				() => this.registry.testConnection(profile, secret)
			);

			if (result.success) {
				vscode.window.showInformationMessage(
					`✅ ${result.message}`
				);
			} else {
				vscode.window.showWarningMessage(
					`⚠️ ${result.message}`
				);
			}
		}

		return profile;
	}

	/**
	 * Run the "Edit Connection" wizard for an existing connection.
	 */
	async editConnection(
		profileId: string
	): Promise<ConnectionProfile | undefined> {
		const existing = await this.store.getProfile(profileId);
		if (!existing) {
			vscode.window.showErrorMessage("Connection not found");
			return undefined;
		}

		const provider = this.registry.getProviderForType(
			existing.providerType
		);
		if (!provider) {
			vscode.window.showErrorMessage(
				`No provider for type "${existing.providerType}"`
			);
			return undefined;
		}

		const fields = provider.getConfigurationFields(existing.providerType);

		// Pre-fill with existing values
		const existingValues: Record<string, string> = {
			name: existing.name,
		};
		for (const field of fields) {
			if (!field.isSecret && field.key in existing) {
				existingValues[field.key] = String(
					(existing as unknown as Record<string, unknown>)[field.key] ?? ""
				);
			}
		}

		const values = await this.collectFields(fields, existingValues);
		if (!values) return undefined;

		const profile = this.buildProfile(
			profileId,
			existing.providerType,
			values,
			fields
		);
		profile.isDefault = existing.isDefault;

		// Update secret if changed
		const secretField = fields.find((f) => f.isSecret);
		if (secretField && values[secretField.key]) {
			await this.store.setSecret(profileId, values[secretField.key]);
		}

		await this.store.saveProfile(profile);
		return profile;
	}

	// ─── Internal Steps ──────────────────────────────────────────────

	private async pickProvider(): Promise<
		| {
				provider: ReturnType<
					ConnectionProviderRegistry["getAllProviders"]
				>[number];
				providerType: ConnectionProviderType;
		  }
		| undefined
	> {
		const providers = this.registry.getAllProviders();
		const items: (vscode.QuickPickItem & {
			provider: (typeof providers)[number];
			providerType: ConnectionProviderType;
		})[] = [];

		for (const provider of providers) {
			for (const pt of provider.providerTypes) {
				const customIconProviders = ["foundry", "openai", "anthropic"];
				const hasCustomIcon = customIconProviders.includes(pt) && this.extensionPath;
				items.push({
					label: provider.label,
					description: pt,
					iconPath: hasCustomIcon
						? {
							dark: vscode.Uri.file(require("path").join(this.extensionPath!, "icons", "dark", `${pt}.svg`)),
							light: vscode.Uri.file(require("path").join(this.extensionPath!, "icons", "light", `${pt}.svg`)),
						}
						: new vscode.ThemeIcon(provider.iconId),
					provider,
					providerType: pt,
				});
			}
		}

		const picked = await vscode.window.showQuickPick(items, {
			placeHolder: "Select a provider",
			title: "Add Connection",
		});

		return picked
			? { provider: picked.provider, providerType: picked.providerType }
			: undefined;
	}

	private async collectFields(
		fields: ConnectionField[],
		existingValues?: Record<string, string>
	): Promise<Record<string, string> | undefined> {
		const values: Record<string, string> = {};

		for (const field of fields) {
			const defaultVal =
				existingValues?.[field.key] ?? field.defaultValue ?? "";

			const value = await vscode.window.showInputBox({
				title: field.label,
				prompt: field.label,
				placeHolder: field.placeholder,
				value: field.isSecret ? "" : defaultVal,
				password: field.isSecret,
				validateInput: (input) => {
					if (field.required && !input.trim()) {
						return `${field.label} is required`;
					}
					if (field.validationPattern) {
						const regex = new RegExp(field.validationPattern);
						if (!regex.test(input)) {
							return (
								field.validationMessage ??
								`Invalid ${field.label}`
							);
						}
					}
					return undefined;
				},
			});

			if (value === undefined) return undefined; // cancelled

			if (value.trim()) {
				values[field.key] = value.trim();
			}
		}

		return values;
	}

	private buildProfile(
		id: string,
		providerType: ConnectionProviderType,
		values: Record<string, string>,
		fields: ConnectionField[]
	): ConnectionProfile {
		// Determine auth type — aligns with AgentSchema Connection.kind
		let authType: string;
		if (providerType === "foundry") {
			authType = "foundry";
		} else if (fields.some((f) => f.isSecret)) {
			authType = "key";
		} else {
			authType = "anonymous";
		}

		const profile: Record<string, unknown> = {
			id,
			name: values.name || `${providerType} connection`,
			providerType,
			authType,
		};

		// Copy non-secret values to profile
		for (const field of fields) {
			if (!field.isSecret && values[field.key]) {
				profile[field.key] = values[field.key];
			}
		}

		// Foundry connections are always model connections
		if (providerType === "foundry") {
			profile.connectionType = "model";
		}

		return profile as unknown as ConnectionProfile;
	}
}
