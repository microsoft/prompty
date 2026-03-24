import * as path from 'path';
import * as vscode from 'vscode';
import { commands, ExtensionContext, languages, Uri, window, workspace } from 'vscode';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';
import { PromptyTraceProvider } from './providers/promptyTraceProvider';
import { PromptyController } from './controllers/promptyController';
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
		connectionRegistry
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

	startLanguageServer(context);

	// ── Export public API for external extensions ─────────────────
	const api: PromptyExtensionAPI = {
		registerConnectionProvider: (provider) =>
			connectionRegistry.registerProvider(provider),
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

function startLanguageServer(context: ExtensionContext) {
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
	};

	client = new LanguageClient("promptyLanguageServer", "Prompty", serverOptions, clientOptions);
	client.start();
}
