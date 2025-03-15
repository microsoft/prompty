/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from 'path';
import { ExtensionContext } from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
	// The server is implemented in node
	startLanguageServer(context);
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}


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
			yamlSchemaPath: context.asAbsolutePath(path.join("schemas", "prompty.yaml")),
		},
	};

	client = new LanguageClient("promptyLanguageServer", "Prompty", serverOptions, clientOptions);
	client.start();
};
