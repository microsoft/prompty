/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	ProposedFeatures,
	InitializeParams,
	TextDocumentSyncKind,
	InitializeResult,
} from 'vscode-languageserver/node';

import { URI } from "vscode-uri";

import {
	TextDocument
} from 'vscode-languageserver-textdocument';
import { getSemanticTokenLegend } from './utils/semantic-tokens';
import { getLanguageService } from "yaml-language-server";
import * as fs from "fs/promises";
import { Logger } from './utils/logger';
import { DocumentMetadataStore } from './utils/document-metadata';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// logger
const logger = new Logger(connection.console);
const schemaRequestService = async (uri: string): Promise<string> => {
	console.log(`Fetching schema for ${uri}`);
	if (/^file:\/\//.test(uri)) {
		const fsPath = URI.parse(uri).fsPath;
		const schema = await fs.readFile(fsPath, { encoding: "utf-8" });
		return schema;
	}
	throw new Error(`Unsupported schema URI: ${uri}`);
};

const yamlLanguageServer = getLanguageService({
	schemaRequestService,
	workspaceContext: {
		resolveRelativePath: (relativePath: string) => {
			return URI.file(relativePath).toString();
		},
	},
});

// Create a simple text document manager.
const documents = new TextDocuments(TextDocument);
const documentMetadata = new DocumentMetadataStore(logger);



connection.onInitialize((params: InitializeParams) => {
	//const capabilities = params.capabilities;
	//logger.debug(`Initializing server for ${params.clientInfo?.name || "unknown"}`);
	console.log(`Initializing server for ${params.clientInfo?.name || "unknown"}`);


	documents.onDidOpen((e) => {
		//console.log(`Document opened: ${e.document.uri}`);
		documentMetadata.set(e.document);
	});

	documents.onDidClose((e) => {
		//console.log(`Document closed: ${e.document.uri}`);
		documentMetadata.delete(e.document.uri);
	});

	connection.onShutdown(() => {
		//console.log("Shutting down...");
	});


	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	connection.onRequest("textDocument/semanticTokens/full", async (params) => {
		//logger.debug(`Received semantic tokens request for ${params.textDocument.uri}`);
		//console.log(`Received semantic tokens request for ${params.textDocument.uri}`);
		// Here you would implement the logic to return semantic tokens for the document.
		// For now, we will return an empty array of tokens.
		return {
			data: [],
		};
	});

	const { yamlSchemaPath } = params.initializationOptions;

	yamlLanguageServer.configure({
		customTags: [],
		completion: true,
		validate: true,
		hover: true,
		format: true,
		schemas: [
			{
				fileMatch: ["*.prompty"],
				uri: URI.file(yamlSchemaPath).toString(),
				name: "prompty",
			},
		],
	});

	const result: InitializeResult = {
		capabilities: {
			semanticTokensProvider: {
				documentSelector: [
					{
						// This should be a list of all the document selectors that the server supports.
						scheme: "file",
						pattern: "**/*.prompty",
					}
				],
				legend: getSemanticTokenLegend(),
				full: true,
			},
			textDocumentSync: TextDocumentSyncKind.Full,
			hoverProvider: true,
			documentOnTypeFormattingProvider: {
				firstTriggerCharacter: ":",
				moreTriggerCharacter: ["\n"],
			},
			// Tell the client that the server supports code completion
			completionProvider: {
				resolveProvider: false,
				/* This config should come from the config of the document (template engine) */
				triggerCharacters: ["{", ":"],
			},
		},
	};
	return result;
});

connection.onCompletion(async (textDocumentPosition) => {
	//logger.debug(`Received completion request for ${textDocumentPosition.textDocument.uri}`);
	//.log(`Received completion request for ${textDocumentPosition.textDocument.uri}`);
	// Here you would implement the logic to return completion items for the document.
	// For now, we will return an empty array of completion items.

	const document = documents.get(textDocumentPosition.textDocument.uri);
	if (!document) {
		return null;
	}
	const metadata = documentMetadata.get(document);
	if (metadata.frontMatterStart === undefined) {
		return null;
	}
	if (metadata.frontMatterEnd === undefined) {
		return null;
	}
	const { line } = textDocumentPosition.position;
	if (line <= metadata.frontMatterStart) {
		return null;
	} else if (line < metadata.frontMatterEnd) {
		
		/*
		const symbols = await yamlLanguageServer.findDocumentSymbols2(document, {
			resultLimit: 100,
		});
		console.log(`Symbols: ${JSON.stringify(symbols)}`);
		*/

		const completion = await yamlLanguageServer.doComplete(document, textDocumentPosition.position, false);
		//console.log(`Completion: ${JSON.stringify(completion)}`);
		return completion;
	}

	return null;
});

connection.onHover(async (textDocumentPosition) => {
	//logger.debug(`Received hover request for ${textDocumentPosition.textDocument.uri}`);
	//console.log(`Received hover request for ${textDocumentPosition.textDocument.uri}`);
	// Here you would implement the logic to return hover information for the document.
	const document = documents.get(textDocumentPosition.textDocument.uri);
	if (!document) {
		return null;
	}
	const metadata = documentMetadata.get(document);

	if (metadata.frontMatterStart === undefined) {
		return null;
	}

	if (metadata.frontMatterEnd === undefined) {
		return null;
	}

	const { line } = textDocumentPosition.position;

	if (line <= metadata.frontMatterStart) {
		return null;
	} else if (line < metadata.frontMatterEnd) {
		const hover = await yamlLanguageServer.doHover(document, textDocumentPosition.position);
		//console.log(`Hover: ${JSON.stringify(hover)}`);
		return hover;
	}
	return null;
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
connection.onDocumentOnTypeFormatting((params) => {
	//logger.debug(`Received on type formatting request for ${params.textDocument.uri}`);
	//console.log(`Received on type formatting request for ${params.textDocument.uri}`);
	// Here you would implement the logic to return formatting edits for the document.
	// For now, we will return an empty array of text edits.
	return null;
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
