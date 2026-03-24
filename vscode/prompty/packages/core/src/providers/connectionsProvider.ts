import * as vscode from "vscode";
import { ConnectionStore } from "../connections/store";
import { ConnectionProviderRegistry } from "../connections/registry";
import {
	ConnectionProfile,
	ConnectionStatus,
	ConnectionProviderType,
} from "../connections/types";

// ─── Tree Items ───────────────────────────────────────────────────────

export class PropertyTreeItem extends vscode.TreeItem {
	constructor(
		public readonly key: string,
		public readonly value: string
	) {
		super(key, vscode.TreeItemCollapsibleState.None);
		this.description = value;
		this.contextValue = "connection-property";
		this.iconPath = new vscode.ThemeIcon("symbol-field");
	}
}

export class ConnectionTreeItem extends vscode.TreeItem {
	constructor(
		public readonly profile: ConnectionProfile,
		public readonly status: ConnectionStatus,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(profile.name, collapsibleState);

		this.contextValue = `connection-${profile.authType}`;
		this.description = this.getDescription();
		this.iconPath = this.getIcon();
		this.tooltip = this.getTooltip();

		if (profile.isDefault) {
			this.contextValue += "-default";
		}
	}

	private getDescription(): string {
		const parts: string[] = [];
		if ("endpoint" in this.profile) {
			const endpoint = (this.profile as any).endpoint as string;
			try {
				parts.push(new URL(endpoint).hostname);
			} catch {
				parts.push(endpoint);
			}
		}
		if ("model" in this.profile) {
			parts.push((this.profile as any).model as string);
		}
		if ("deployment" in this.profile) {
			parts.push((this.profile as any).deployment as string);
		}
		if (this.profile.isDefault) {
			parts.push("★ default");
		}
		return parts.filter(Boolean).join(" · ");
	}

	private getIcon(): vscode.ThemeIcon {
		switch (this.status) {
			case "configured":
				return new vscode.ThemeIcon(
					"pass-filled",
					new vscode.ThemeColor("testing.iconPassed")
				);
			case "missing-secret":
				return new vscode.ThemeIcon(
					"warning",
					new vscode.ThemeColor("problemsWarningIcon.foreground")
				);
			case "error":
				return new vscode.ThemeIcon(
					"error",
					new vscode.ThemeColor("problemsErrorIcon.foreground")
				);
			case "untested":
			default:
				return new vscode.ThemeIcon("circle-outline");
		}
	}

	private getTooltip(): vscode.MarkdownString {
		const md = new vscode.MarkdownString();
		md.appendMarkdown(`**${this.profile.name}**\n\n`);
		md.appendMarkdown(`Provider: \`${this.profile.providerType}\`\n\n`);
		md.appendMarkdown(`Auth: \`${this.profile.authType}\`\n\n`);

		if ("endpoint" in this.profile) {
			md.appendMarkdown(
				`Endpoint: \`${(this.profile as any).endpoint}\`\n\n`
			);
		}

		const statusLabel = {
			configured: "✅ Connected",
			"missing-secret": "⚠️ Missing API key",
			error: "❌ Error",
			untested: "○ Not tested",
		}[this.status];
		md.appendMarkdown(`Status: ${statusLabel}`);

		return md;
	}
}

export class ProviderGroupItem extends vscode.TreeItem {
	constructor(
		public readonly providerType: ConnectionProviderType,
		public readonly label: string,
		public readonly connections: ConnectionProfile[],
		public readonly iconId: string
	) {
		super(
			label,
			connections.length > 0
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.Collapsed
		);
		this.contextValue = "provider-group";
		this.iconPath = new vscode.ThemeIcon(iconId);
		this.description = `${connections.length} connection${connections.length !== 1 ? "s" : ""}`;
	}
}

// ─── Tree Data Provider ───────────────────────────────────────────────

type TreeItem = ProviderGroupItem | ConnectionTreeItem | PropertyTreeItem;

export class ConnectionsTreeDataProvider
	implements vscode.TreeDataProvider<TreeItem>
{
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<
		TreeItem | undefined
	>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private connectionStatuses = new Map<string, ConnectionStatus>();

	constructor(
		private readonly store: ConnectionStore,
		private readonly registry: ConnectionProviderRegistry
	) {
		store.onDidChange(() => this.refresh());
		registry.onProvidersChanged(() => this.refresh());
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element: TreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: TreeItem): Promise<TreeItem[]> {
		if (!element) {
			return this.getRootItems();
		}

		if (element instanceof ProviderGroupItem) {
			return this.getConnectionItems(element.connections);
		}

		if (element instanceof ConnectionTreeItem) {
			return this.getPropertyItems(element.profile);
		}

		return [];
	}

	private getPropertyItems(profile: ConnectionProfile): PropertyTreeItem[] {
		const items: PropertyTreeItem[] = [];
		const skip = new Set(["id", "name", "isDefault", "metadata"]);

		for (const [key, value] of Object.entries(profile)) {
			if (skip.has(key) || value === undefined || value === null) {
				continue;
			}

			let display: string;
			if (key === "authType") {
				display = String(value);
				items.push(new PropertyTreeItem("auth", display));
			} else if (key === "providerType") {
				items.push(new PropertyTreeItem("provider", String(value)));
			} else if (key === "endpoint") {
				try {
					display = new URL(String(value)).hostname;
				} catch {
					display = String(value);
				}
				items.push(new PropertyTreeItem("endpoint", display));
			} else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
				items.push(new PropertyTreeItem(key, String(value)));
			}
		}

		if (profile.isDefault) {
			items.push(new PropertyTreeItem("default", "★ yes"));
		}

		return items;
	}

	private async getRootItems(): Promise<ProviderGroupItem[]> {
		const profiles = await this.store.getProfiles();
		const providers = this.registry.getAllProviders();

		// Group connections by provider type
		const groups: ProviderGroupItem[] = [];

		for (const provider of providers) {
			for (const providerType of provider.providerTypes) {
				const connections = profiles.filter(
					(p) => p.providerType === providerType
				);
				groups.push(
					new ProviderGroupItem(
						providerType,
						provider.label,
						connections,
						provider.iconId
					)
				);
			}
		}

		// Add any connections from unknown providers
		const knownTypes = new Set(
			providers.flatMap((p) => p.providerTypes)
		);
		const unknownConnections = profiles.filter(
			(p) => !knownTypes.has(p.providerType)
		);
		if (unknownConnections.length > 0) {
			groups.push(
				new ProviderGroupItem(
					"unknown",
					"Other",
					unknownConnections,
					"question"
				)
			);
		}

		return groups;
	}

	private async getConnectionItems(
		connections: ConnectionProfile[]
	): Promise<ConnectionTreeItem[]> {
		const items: ConnectionTreeItem[] = [];

		for (const conn of connections) {
			let status =
				this.connectionStatuses.get(conn.id) ?? "untested";

			// Check if secret is needed but missing
			if (conn.authType === "api-key" && status === "untested") {
				const secret = await this.store.getSecret(conn.id);
				if (!secret) {
					status = "missing-secret";
				}
			}

			items.push(
				new ConnectionTreeItem(
					conn,
					status,
					vscode.TreeItemCollapsibleState.Collapsed
				)
			);
		}

		return items;
	}

	/** Update the status of a connection (after testing, etc.) */
	setConnectionStatus(connectionId: string, status: ConnectionStatus): void {
		this.connectionStatuses.set(connectionId, status);
		this.refresh();
	}

	dispose(): void {
		this._onDidChangeTreeData.dispose();
	}
}
