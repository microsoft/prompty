import * as path from 'path';
import { commands, ExtensionContext, Uri } from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';
import { PromptyTraceProvider } from './providers/promptyTraceProvider';
import { PromptyController } from './controllers/promptyController';
import { TraceFileProvider, TraceItem } from './providers/traceFileProvider';

let client: LanguageClient;

export function activate(context: ExtensionContext) {

	const promptyController = new PromptyController(context);
	TraceFileProvider.createTreeView(context, "view-traces", "prompty.refreshTraces");
	context.subscriptions.push(
		promptyController,
		commands.registerCommand("prompty.runPrompt", (uri: Uri) => promptyController.run(uri)),
		commands.registerCommand("prompty.viewTrace", async (traceItem: TraceItem) => {
			if (!traceItem.trace.uri) {
				return;
			}
			commands.executeCommand("vscode.open", traceItem.trace.uri);
		}),
		// Register the custom editor provider for the trace viewer
		PromptyTraceProvider.register(context)
	);

	// The server is implemented in node
	startLanguageServer(context);
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}

// ignore unused variable warning
const startLanguageServer = (context: ExtensionContext) => {
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
};
