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
import { VirtualDocument } from './utils/virtual-document';
import * as path from 'path';


// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// initialization options
const options = {
	basePath: "",
	yamlSchemaPath: "",
};

// logger
const logger = new Logger(connection.console);
const schemaRequestService = async (uri: string): Promise<string> => {
	//console.log(`Fetching schema for ${uri}`);
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
			const schemaUri = URI.file(path.join(options.basePath, relativePath)).toString();
			//console.log(`Using schema URI: ${schemaUri}`);
			return schemaUri;
		},
	},
});

// Create a simple text document manager.
const documents = new TextDocuments(TextDocument);
const documentMetadata = new DocumentMetadataStore(logger);

async function validateTextDocument(textDocument: TextDocument) {
	const metadata = documentMetadata.get(textDocument);
	if (metadata.frontMatterStart === undefined) {
		return;
	}
	if (metadata.frontMatterEnd === undefined) {
		return;
	}
	const virtualDocument = new VirtualDocument(
		textDocument,
		metadata.frontMatterStart + 1,
		metadata.frontMatterEnd - 1
	);
	await validateYAMLDocument(virtualDocument);
}

async function validateYAMLDocument(textDocument: VirtualDocument) {
	logger.debug(`Validating document: ${textDocument.uri}`);
	const virtualYamlDiagnostics = await yamlLanguageServer.doValidation(textDocument, false);
	const yamlDiagnostics = virtualYamlDiagnostics
		.filter((d) => {
			const diagnosticText = textDocument.getText(d.range).trim();
			return !/\$\{[^}]+\}/.test(diagnosticText);
		})
		.map((s) => {
			return {
				...s,
				range: {
					start: textDocument.toRealPosition(s.range.start),
					end: textDocument.toRealPosition(s.range.end),
				},
				source: `\nyaml-schema: ${s.source?.split("/").pop()}`,
			};
		});

	console.log(`YAML Diagnostics: ${JSON.stringify(yamlDiagnostics)}`);
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: yamlDiagnostics });
}

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

	documents.onDidChangeContent((e) => {
		//console.log(`Document changed: ${e.document.uri}`);
		documentMetadata.set(e.document);
		validateTextDocument(e.document);
	});

	connection.onShutdown(() => {
		//console.log("Shutting down...");
	});



	connection.onRequest("textDocument/semanticTokens/full", async () => {
		//console.log(`Received semantic tokens request for ${params.textDocument.uri}`);
		// Here you would implement the logic to return semantic tokens for the document.
		// For now, we will return an empty array of tokens.
		return {
			data: [],
		};
	});

	const { basePath, yamlSchemaPath } = params.initializationOptions;

	if (!basePath || !yamlSchemaPath) {
		throw new Error("Initialization options 'basePath' and 'yamlSchemaPath' are required.");
	}

	options.basePath = basePath;
	options.yamlSchemaPath = yamlSchemaPath;

	// uri for the schema
	const schemaUri = URI.file(path.join(basePath, yamlSchemaPath)).toString();
	//console.log(`Using schema URI: ${schemaUri}`);

	yamlLanguageServer.configure({
		customTags: [],
		completion: true,
		validate: true,
		hover: true,
		format: true,
		schemas: [
			{
				fileMatch: ["*.prompty"],
				uri: schemaUri,
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
				resolveProvider: true,
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
		try {
			const completion = await yamlLanguageServer.doComplete(document, textDocumentPosition.position, false);
			return completion;
		} catch (error) {
			console.error(`Error during completion: ${error}`);
			return null;
		}
	}
});

connection.onHover(async (textDocumentPosition) => {
	//logger.debug(`Received hover request for ${textDocumentPosition.textDocument.uri}`);
	console.log(`Received hover request for ${textDocumentPosition.textDocument.uri}`);
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
		try { 
		const hover = await yamlLanguageServer.doHover(document, textDocumentPosition.position);

		//console.log(`Hover: ${JSON.stringify(hover?.contents)}`);
		if (hover && hover.contents) {
			// Process hover contents
			return hover;
		}
	} catch (error) {
		console.error(`Error during hover: ${error}`);
	}

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
