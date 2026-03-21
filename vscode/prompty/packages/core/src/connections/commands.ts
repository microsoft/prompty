import * as vscode from "vscode";
import { ConnectionStore } from "./store";
import { ConnectionProviderRegistry } from "./registry";
import { ConnectionWizard } from "./wizard";
import {
	ConnectionsTreeDataProvider,
	ConnectionTreeItem,
} from "../providers/connectionsProvider";

/**
 * Registers all connection-related commands.
 * Returns disposables to be pushed to the extension context.
 */
export function registerConnectionCommands(
	context: vscode.ExtensionContext,
	store: ConnectionStore,
	registry: ConnectionProviderRegistry,
	treeProvider: ConnectionsTreeDataProvider
): vscode.Disposable[] {
	const wizard = new ConnectionWizard(store, registry);

	const disposables: vscode.Disposable[] = [];

	// ─── Add Connection ──────────────────────────────────────────

	disposables.push(
		vscode.commands.registerCommand("prompty.addConnection", async () => {
			await wizard.addConnection();
		})
	);

	// ─── Edit Connection ─────────────────────────────────────────

	disposables.push(
		vscode.commands.registerCommand(
			"prompty.editConnection",
			async (item?: ConnectionTreeItem) => {
				if (!item) {
					const profiles = await store.getProfiles();
					if (profiles.length === 0) {
						vscode.window.showInformationMessage(
							"No connections configured. Add one first."
						);
						return;
					}
					const picked = await vscode.window.showQuickPick(
						profiles.map((p) => ({
							label: p.name,
							description: p.providerType,
							id: p.id,
						})),
						{ placeHolder: "Select a connection to edit" }
					);
					if (!picked) return;
					await wizard.editConnection(picked.id);
				} else {
					await wizard.editConnection(item.profile.id);
				}
			}
		)
	);

	// ─── Delete Connection ───────────────────────────────────────

	disposables.push(
		vscode.commands.registerCommand(
			"prompty.deleteConnection",
			async (item?: ConnectionTreeItem) => {
				let profileId: string;
				let profileName: string;

				if (item) {
					profileId = item.profile.id;
					profileName = item.profile.name;
				} else {
					const profiles = await store.getProfiles();
					const picked = await vscode.window.showQuickPick(
						profiles.map((p) => ({
							label: p.name,
							description: p.providerType,
							id: p.id,
						})),
						{ placeHolder: "Select a connection to delete" }
					);
					if (!picked) return;
					profileId = picked.id;
					profileName = picked.label;
				}

				const confirm = await vscode.window.showWarningMessage(
					`Delete connection "${profileName}"?`,
					{ modal: true },
					"Delete"
				);
				if (confirm === "Delete") {
					await store.deleteProfile(profileId);
					vscode.window.showInformationMessage(
						`Connection "${profileName}" deleted.`
					);
				}
			}
		)
	);

	// ─── Test Connection ─────────────────────────────────────────

	disposables.push(
		vscode.commands.registerCommand(
			"prompty.testConnection",
			async (item?: ConnectionTreeItem) => {
				let profileId: string;

				if (item) {
					profileId = item.profile.id;
				} else {
					const profiles = await store.getProfiles();
					const picked = await vscode.window.showQuickPick(
						profiles.map((p) => ({
							label: p.name,
							description: p.providerType,
							id: p.id,
						})),
						{ placeHolder: "Select a connection to test" }
					);
					if (!picked) return;
					profileId = picked.id;
				}

				const profile = await store.getProfile(profileId);
				if (!profile) return;

				const secret = await store.getSecret(profileId);

				const result = await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: `Testing "${profile.name}"...`,
					},
					() => registry.testConnection(profile, secret)
				);

				if (result.success) {
					treeProvider.setConnectionStatus(
						profileId,
						"configured"
					);
					vscode.window.showInformationMessage(
						`✅ ${result.message}`
					);
				} else {
					treeProvider.setConnectionStatus(profileId, "error");
					vscode.window.showWarningMessage(
						`⚠️ ${result.message}`
					);
				}
			}
		)
	);

	// ─── Set Default Connection ──────────────────────────────────

	disposables.push(
		vscode.commands.registerCommand(
			"prompty.setDefaultConnection",
			async (item?: ConnectionTreeItem) => {
				let profileId: string;
				let profileName: string;

				if (item) {
					profileId = item.profile.id;
					profileName = item.profile.name;
				} else {
					const profiles = await store.getProfiles();
					const picked = await vscode.window.showQuickPick(
						profiles.map((p) => ({
							label: `${p.isDefault ? "★ " : ""}${p.name}`,
							description: p.providerType,
							id: p.id,
						})),
						{
							placeHolder: "Select the default connection",
						}
					);
					if (!picked) return;
					profileId = picked.id;
					profileName = picked.label;
				}

				await store.setDefault(profileId);
				vscode.window.showInformationMessage(
					`"${profileName}" set as default.`
				);
			}
		)
	);

	// ─── Refresh Connections ─────────────────────────────────────

	disposables.push(
		vscode.commands.registerCommand("prompty.refreshConnections", () => {
			treeProvider.refresh();
		})
	);

	return disposables;
}
