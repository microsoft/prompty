import * as vscode from "vscode";
import * as path from "path";
import { ConnectionStore } from "../connections/store";
import { ConnectionProviderRegistry } from "../connections/registry";
import {
	ConnectionProfile,
	ConnectionStatus,
	ConnectionProviderType,
	ModelInfo,
} from "../connections/types";

/** Resolve a dark/light icon pair from the extension's icons directory */
function iconPath(extensionPath: string, name: string): { dark: vscode.Uri; light: vscode.Uri } {
	return {
		dark: vscode.Uri.file(path.join(extensionPath, "icons", "dark", `${name}.svg`)),
		light: vscode.Uri.file(path.join(extensionPath, "icons", "light", `${name}.svg`)),
	};
}

// Lazy-initialized extension path (set once from the tree data provider)
let _extensionPath = "";

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

export class ModelTreeItem extends vscode.TreeItem {
	constructor(public readonly model: ModelInfo) {
		super(model.id, vscode.TreeItemCollapsibleState.None);
		this.description = model.modelName ?? model.ownedBy;
		this.contextValue = "connection-model";
		this.iconPath = _extensionPath ? iconPath(_extensionPath, "model") : new vscode.ThemeIcon("hubot");
		if (model.modelName && model.modelName !== model.id) {
			this.tooltip = `${model.id} → ${model.modelName}`;
		}
	}
}

export class SectionTreeItem extends vscode.TreeItem {
	constructor(
		label: string,
		public readonly sectionType: "properties" | "models",
		public readonly profile: ConnectionProfile,
		iconId: string,
		childCount?: number
	) {
		super(label, vscode.TreeItemCollapsibleState.Collapsed);
		this.contextValue = `connection-section-${sectionType}`;
		if (sectionType === "models" && _extensionPath) {
			this.iconPath = iconPath(_extensionPath, "models");
		} else {
			this.iconPath = new vscode.ThemeIcon(iconId);
		}
		if (childCount !== undefined) {
			this.description = `${childCount}`;
		}
	}
}

export class ConnectionTreeItem extends vscode.TreeItem {
	constructor(
		public readonly profile: ConnectionProfile,
		public readonly status: ConnectionStatus,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(
			profile.isDefault ? `★ ${profile.name}` : profile.name,
			collapsibleState
		);

		this.contextValue = `conn-profile-${profile.authType}`;
		this.description = this.getDescription();
		this.iconPath = this.getIcon();
		this.tooltip = this.getTooltip();

		if (profile.isDefault) {
			this.contextValue += "-default";
		}
	}

	private getIcon(): vscode.ThemeIcon {
		switch (this.status) {
			case "configured":
				return new vscode.ThemeIcon(
					"plug",
					new vscode.ThemeColor("testing.iconPassed")
				);
			case "missing-secret":
				return new vscode.ThemeIcon(
					"plug",
					new vscode.ThemeColor("problemsWarningIcon.foreground")
				);
			case "error":
				return new vscode.ThemeIcon(
					"plug",
					new vscode.ThemeColor("problemsErrorIcon.foreground")
				);
			case "untested":
			default:
				return new vscode.ThemeIcon("plug");
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
		return parts.filter(Boolean).join(" · ");
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
		// Use custom SVGs for known providers, ThemeIcon for others
		const customIconProviders = ["foundry", "openai", "anthropic"];
		if (customIconProviders.includes(providerType) && _extensionPath) {
			this.iconPath = iconPath(_extensionPath, providerType);
		} else {
			this.iconPath = new vscode.ThemeIcon(iconId);
		}
		this.description = `${connections.length} connection${connections.length !== 1 ? "s" : ""}`;
	}
}

// ─── Tree Data Provider ───────────────────────────────────────────────

type TreeItem =
	| ProviderGroupItem
	| ConnectionTreeItem
	| SectionTreeItem
	| PropertyTreeItem
	| ModelTreeItem;

export class ConnectionsTreeDataProvider
	implements vscode.TreeDataProvider<TreeItem>
{
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<
		TreeItem | undefined
	>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private connectionStatuses = new Map<string, ConnectionStatus>();

	private modelCache = new Map<string, ModelInfo[]>();

	constructor(
		private readonly store: ConnectionStore,
		private readonly registry: ConnectionProviderRegistry,
		extensionPath: string
	) {
		_extensionPath = extensionPath;
		store.onDidChange(() => this.refresh());
		registry.onProvidersChanged(() => this.refresh());
	}

	refresh(): void {
		this.modelCache.clear();
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
			return this.getSectionItems(element.profile);
		}

		if (element instanceof SectionTreeItem) {
			if (element.sectionType === "properties") {
				return this.getPropertyItems(element.profile);
			}
			if (element.sectionType === "models") {
				return this.getModelItems(element.profile);
			}
		}

		return [];
	}

	private async getSectionItems(profile: ConnectionProfile): Promise<SectionTreeItem[]> {
		const items: SectionTreeItem[] = [];
		items.push(
			new SectionTreeItem("Properties", "properties", profile, "list-unordered")
		);

		// Only show Models section for providers that support model discovery
		const provider = this.registry.getProviderForType(profile.providerType);
		if (provider?.listModels) {
			// Auto-fetch models on first expand if not cached
			if (!this.modelCache.has(profile.id)) {
				await this.fetchModels(profile);
			}
			const cachedModels = this.modelCache.get(profile.id);
			items.push(
				new SectionTreeItem(
					"Models",
					"models",
					profile,
					"library",
					cachedModels?.length
				)
			);
		}

		return items;
	}

	private async getModelItems(profile: ConnectionProfile): Promise<ModelTreeItem[]> {
		// Check cache first
		const cached = this.modelCache.get(profile.id);
		if (cached) {
			return cached.map((m) => new ModelTreeItem(m));
		}

		// Fetch from provider
		const provider = this.registry.getProviderForType(profile.providerType);
		if (!provider?.listModels) return [];

		try {
			const secret = await this.store.getSecret(profile.id);
			const models = await provider.listModels(profile, secret ?? undefined);
			if (models) {
				this.modelCache.set(profile.id, models);
				return models.map((m) => new ModelTreeItem(m));
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[Prompty] Model discovery failed for "${profile.name}": ${msg}`);
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
			if (conn.authType === "key" && status === "untested") {
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
		this._onDidChangeTreeData.fire(undefined);
	}

	/** Fetch and cache models for a connection (called during tree expansion or after test) */
	async fetchModels(profile: ConnectionProfile, secret?: string): Promise<void> {
		const provider = this.registry.getProviderForType(profile.providerType);
		if (!provider?.listModels) return;

		try {
			if (!secret) {
				secret = (await this.store.getSecret(profile.id)) ?? undefined;
			}
			const models = await provider.listModels(profile, secret);
			if (models) {
				this.modelCache.set(profile.id, models);
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[Prompty] Model fetch failed for "${profile.name}": ${msg}`);
		}
	}

	/** Clear cached models for a connection and re-fetch */
	async refreshModels(profile: ConnectionProfile): Promise<void> {
		this.modelCache.delete(profile.id);
		await this.fetchModels(profile);
		this._onDidChangeTreeData.fire(undefined);
	}

	dispose(): void {
		this._onDidChangeTreeData.dispose();
	}
}
