import * as path from 'path';
import * as vscode from 'vscode';
import { commands, ExtensionContext, languages, Uri, window, workspace } from 'vscode';
import {
	LanguageClient,
	LanguageClientOptions,
	RevealOutputChannelOn,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';
import { registerExecutor, registerProcessor } from '@prompty/core';
import { PromptyTraceProvider } from './providers/promptyTraceProvider';
import { PromptyController } from './controllers/promptyController';
import { PreviewPanel } from './controllers/previewPanel';
import { TraceFileProvider, TraceItem } from './providers/traceFileProvider';
import { PromptySymbolProvider } from './providers/promptySymbolProvider';
import { ConnectionProviderRegistry } from './connections/registry';
import { ConnectionStore } from './connections/store';
import { ConnectionsTreeDataProvider } from './providers/connectionsProvider';
import { registerConnectionCommands } from './connections/commands';
import { OpenAIConnectionProvider } from './connections/providers/openai';
import { AnthropicConnectionProvider } from './connections/providers/anthropic';
import { FoundryConnectionProvider } from './connections/providers/foundry';
import type { PromptyExtensionAPI } from './connections/api';

let client: LanguageClient;

export function activate(context: ExtensionContext): PromptyExtensionAPI {
	// ── Connections infrastructure ────────────────────────────────
	const connectionRegistry = new ConnectionProviderRegistry();
	const connectionStore = new ConnectionStore(context.secrets);
	const connectionsTreeProvider = new ConnectionsTreeDataProvider(
		connectionStore,
		connectionRegistry,
		context.extensionPath
	);

	// Register built-in connection providers
	connectionRegistry.registerProvider(new FoundryConnectionProvider());
	connectionRegistry.registerProvider(new OpenAIConnectionProvider());
	connectionRegistry.registerProvider(new AnthropicConnectionProvider());

	// Register the Connections sidebar view
	const connectionsView = window.createTreeView("view-connections", {
		treeDataProvider: connectionsTreeProvider,
		showCollapseAll: true,
	});

	// Register connection commands
	const connectionCommandDisposables = registerConnectionCommands(
		context,
		connectionStore,
		connectionRegistry,
		connectionsTreeProvider
	);

	// ── Existing features ────────────────────────────────────────
	// ── Status bar connection selector ───────────────────────────
	const statusBarItem = window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.command = "prompty.setDefaultConnection";
	statusBarItem.tooltip = "Prompty: Active Connection";

	async function updateStatusBar() {
		const profiles = await connectionStore.getProfiles();
		const defaultConn = profiles.find(p => p.isDefault) ?? profiles[0];
		if (defaultConn) {
			statusBarItem.text = `$(plug) ${defaultConn.name}`;
			statusBarItem.show();
		} else {
			statusBarItem.text = "$(plug) No Connection";
			statusBarItem.show();
		}
	}
	updateStatusBar();
	connectionStore.onDidChange(() => updateStatusBar());

	const promptyController = new PromptyController(context, connectionStore, connectionRegistry);
	const traceFileProvider = new TraceFileProvider();
	TraceFileProvider.createTreeView(context, traceFileProvider, "view-traces", "prompty.refreshTraces");

	context.subscriptions.push(
		// New Prompty
		commands.registerCommand("prompty.newPrompt", async (uri?: Uri) => {
			const folder = uri
				? (await workspace.fs.stat(uri)).type & vscode.FileType.Directory ? uri : Uri.file(path.dirname(uri.fsPath))
				: workspace.workspaceFolders?.[0]?.uri;
			if (!folder) {
				window.showErrorMessage("Open a folder first to create a Prompty file.");
				return;
			}
			const name = await window.showInputBox({
				prompt: "Prompty file name",
				value: "prompt.prompty",
				validateInput: (v) => v.endsWith(".prompty") ? null : "File must end with .prompty",
			});
			if (!name) { return; }
			const fileUri = Uri.joinPath(folder, name);
			const scaffold = [
				"---",
				`name: ${name.replace(/\.prompty$/, "")}`,
				"model: gpt-4o-mini",
				"---",
				"system:",
				"You are a helpful assistant.",
				"",
				"user:",
				"{{question}}",
				"",
			].join("\n");
			await workspace.fs.writeFile(fileUri, Buffer.from(scaffold, "utf-8"));
			const doc = await workspace.openTextDocument(fileUri);
			await window.showTextDocument(doc);
		}),
		// Connections
		connectionRegistry,
		connectionStore,
		connectionsTreeProvider,
		connectionsView,
		statusBarItem,
		...connectionCommandDisposables,
		// Existing
		promptyController,
		commands.registerCommand("prompty.runPrompt", (uri: Uri) => promptyController.run(uri)),
		commands.registerCommand("prompty.previewPrompt", () => {
			const editor = window.activeTextEditor;
			if (editor && editor.document.uri.fsPath.endsWith('.prompty')) {
				PreviewPanel.toggle(context, editor);
			}
		}),
		commands.registerCommand("prompty.viewTrace", async (traceItem: TraceItem) => {
			if (!traceItem.trace.uri) {
				return;
			}
			commands.executeCommand("vscode.open", traceItem.trace.uri);
		}),
		PromptyTraceProvider.register(context),
		languages.registerDocumentSymbolProvider({ language: 'prompty' }, new PromptySymbolProvider()),
	);

	workspace.onDidDeleteFiles((event) => {
		if (!event.files || event.files.length === 0) {
			return;
		}
		if (event.files.some((file) => file.fsPath.endsWith(".tracy")) || event.files.some((file) => file.fsPath.endsWith(".runs"))) {
			traceFileProvider.refresh();
		}
	});

	workspace.createFileSystemWatcher("**/*.tracy").onDidCreate((uri) => {
		if (uri.fsPath.endsWith(".tracy") || uri.fsPath.endsWith(".runs")) {
			traceFileProvider.refresh();
		}
	});

	startLanguageServer(context, connectionStore, connectionRegistry);

	// ── Export public API for external extensions ─────────────────
	const api: PromptyExtensionAPI = {
		registerConnectionProvider: (provider) =>
			connectionRegistry.registerProvider(provider),
		registerExecutor: (key, executor) =>
			registerExecutor(key, executor),
		registerProcessor: (key, processor) =>
			registerProcessor(key, processor),
		getConnections: () => connectionStore.getProfiles(),
		onConnectionsChanged: (listener) => {
			const disposable = connectionStore.onDidChange(async () => {
				const profiles = await connectionStore.getProfiles();
				listener(profiles);
			});
			return disposable;
		},
	};

	return api;
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}

function startLanguageServer(
	context: ExtensionContext,
	connectionStore: ConnectionStore,
	connectionRegistry: ConnectionProviderRegistry,
) {
	const serverModule = context.asAbsolutePath(path.join("packages", "server", "out", "server.js"));
	const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions,
		},
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: "file", language: "prompty", pattern: "**/*.prompty" }],
		initializationOptions: {
			basePath: context.asAbsolutePath("schemas"),
			yamlSchemaPath: "Prompty.yaml",
		},
		// Don't auto-show the output channel — diagnostics appear inline in the editor
		revealOutputChannelOn: RevealOutputChannelOn.Never,
	};

	client = new LanguageClient("promptyLanguageServer", "Prompty · Language Server", serverOptions, clientOptions);
	client.start().then(() => {
		// Send initial models and connections to the language server
		sendModelsToServer(connectionStore, connectionRegistry);
		sendConnectionsToServer(connectionStore);

		// Re-send whenever connections change
		connectionStore.onDidChange(() => {
			sendModelsToServer(connectionStore, connectionRegistry);
			sendConnectionsToServer(connectionStore);
		});
	});
}

async function sendModelsToServer(
	store: ConnectionStore,
	registry: ConnectionProviderRegistry,
) {
	if (!client) return;

	const profiles = await store.getProfiles();
	const allModels: Array<{ id: string; displayName?: string; provider: string }> = [];

	// Use the default connection per provider, or the first one found
	const seenProviders = new Set<string>();
	for (const profile of profiles) {
		const providerType = profile.providerType;
		if (seenProviders.has(providerType)) continue;

		const provider = registry.getProviderForType(providerType);
		if (!provider?.listModels) continue;

		try {
			const secret = await store.getSecret(profile.id);
			const models = await provider.listModels(profile, secret);
			if (models) {
				for (const m of models) {
					allModels.push({
						id: m.id,
						displayName: m.modelName ?? m.ownedBy,
						provider: providerType,
					});
				}
				seenProviders.add(providerType);
			}
		} catch {
			// Skip provider on error
		}
	}

	client.sendNotification("prompty/modelsChanged", { models: allModels });
}

async function sendConnectionsToServer(store: ConnectionStore) {
	if (!client) return;

	const profiles = await store.getProfiles();
	const connections = profiles.map(p => ({
		name: p.name,
		id: p.id,
		providerType: p.providerType,
		isDefault: p.isDefault ?? false,
	}));

	client.sendNotification("prompty/connectionsChanged", { connections });
}
