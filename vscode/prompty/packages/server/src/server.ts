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
	Diagnostic,
	DiagnosticSeverity,
} from 'vscode-languageserver/node';

import { URI } from "vscode-uri";

import {
	TextDocument
} from 'vscode-languageserver-textdocument';
import { getSemanticTokenLegend, tokenizeDocument } from './utils/semantic-tokens';
import { getLanguageService } from "yaml-language-server";
import * as fs from "fs/promises";
import { Logger } from './utils/logger';
import { DocumentMetadataStore, DocumentMetadata } from './utils/document-metadata';
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
			return URI.file(path.join(options.basePath, relativePath)).toString();
		},
	},
});

// Create a simple text document manager.
const documents = new TextDocuments(TextDocument);
const documentMetadata = new DocumentMetadataStore(logger);

async function getYamlDiagnostics(virtualDocument: VirtualDocument): Promise<Diagnostic[]> {
	const virtualYamlDiagnostics = await yamlLanguageServer.doValidation(virtualDocument, false);
	return virtualYamlDiagnostics
		.filter((d) => {
			const diagnosticText = virtualDocument.getText(d.range).trim();
			return !/\$\{[^}]+\}/.test(diagnosticText);
		})
		.map((s) => ({
			...s,
			range: {
				start: virtualDocument.toRealPosition(s.range.start),
				end: virtualDocument.toRealPosition(s.range.end),
			},
			source: `\nyaml-schema: ${s.source?.split("/").pop()}`,
		}));
}

function checkV1Deprecations(document: TextDocument, metadata: DocumentMetadata): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const text = document.getText();
	const lines = text.split(/\n|\r\n/);
	const fmStart = metadata.frontMatterStart ?? 0;
	const fmEnd = metadata.frontMatterEnd ?? lines.length;

	const v1Mappings: { pattern: RegExp; message: string }[] = [
		{ pattern: /^\s+api\s*:/, message: "Deprecated v1 property 'api'. Use 'apiType' under 'model' instead." },
		{ pattern: /^\s+configuration\s*:/, message: "Deprecated v1 property 'configuration'. Use 'connection' under 'model' instead." },
		{ pattern: /^\s+api_key\s*:/, message: "Deprecated v1 property 'api_key'. Use 'apiKey' (camelCase) under 'model.connection' instead." },
		{ pattern: /^\s+azure_endpoint\s*:/, message: "Deprecated v1 property 'azure_endpoint'. Use 'endpoint' under 'model.connection' instead." },
		{ pattern: /^\s+azure_deployment\s*:/, message: "Deprecated v1 property 'azure_deployment'. Use 'model.id' instead." },
		{ pattern: /^\s+max_tokens\s*:/, message: "Deprecated v1 property 'max_tokens'. Use 'maxOutputTokens' under 'model.options' instead." },
		{ pattern: /^\s+top_p\s*:/, message: "Deprecated v1 property 'top_p'. Use 'topP' (camelCase) under 'model.options' instead." },
		{ pattern: /^\s+frequency_penalty\s*:/, message: "Deprecated v1 property 'frequency_penalty'. Use 'frequencyPenalty' under 'model.options' instead." },
		{ pattern: /^\s+presence_penalty\s*:/, message: "Deprecated v1 property 'presence_penalty'. Use 'presencePenalty' under 'model.options' instead." },
		{ pattern: /^inputs\s*:/, message: "Deprecated v1 property 'inputs'. Use 'inputSchema' with 'properties' array instead." },
		{ pattern: /^outputs\s*:/, message: "Deprecated v1 property 'outputs'. Use 'outputSchema' instead." },
		{ pattern: /^template\s*:\s*jinja2/, message: "Deprecated v1 template format. Use 'template: { format: { kind: jinja2 } }' instead." },
		{ pattern: /^authors\s*:/, message: "Deprecated v1 property 'authors'. Move to 'metadata.authors' instead." },
		{ pattern: /^tags\s*:/, message: "Deprecated v1 property 'tags'. Move to 'metadata.tags' instead." },
		{ pattern: /^version\s*:/, message: "Deprecated v1 property 'version'. Move to 'metadata.version' instead." },
	];

	for (let i = fmStart + 1; i < fmEnd; i++) {
		for (const mapping of v1Mappings) {
			if (mapping.pattern.test(lines[i])) {
				diagnostics.push({
					severity: DiagnosticSeverity.Warning,
					range: {
						start: { line: i, character: 0 },
						end: { line: i, character: lines[i].length },
					},
					message: mapping.message,
					source: 'prompty',
				});
			}
		}
	}

	return diagnostics;
}

async function validateTextDocument(textDocument: TextDocument) {
	try {
		const metadata = documentMetadata.get(textDocument);
		if (metadata.frontMatterStart === undefined || metadata.frontMatterEnd === undefined) {
			return;
		}

		const virtualDocument = new VirtualDocument(
			textDocument,
			metadata.frontMatterStart + 1,
			metadata.frontMatterEnd - 1
		);

		const allDiagnostics = await getYamlDiagnostics(virtualDocument);

		// Add v1 deprecation warnings
		if (metadata.frontMatterContent) {
			const v1Diagnostics = checkV1Deprecations(textDocument, metadata);
			allDiagnostics.push(...v1Diagnostics);
		}

		// Add parse errors
		for (const error of metadata.parseErrors) {
			allDiagnostics.push({
				severity: DiagnosticSeverity.Error,
				range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
				message: error,
				source: 'prompty',
			});
		}

		connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: allDiagnostics });
	} catch (error) {
		logger.error(`Error validating document: ${error}`);
	}
}

connection.onInitialize((params: InitializeParams) => {
	documents.onDidOpen((e) => {
		documentMetadata.set(e.document);
	});

	documents.onDidClose((e) => {
		documentMetadata.delete(e.document.uri);
	});

	documents.onDidChangeContent((e) => {
		documentMetadata.set(e.document);
		validateTextDocument(e.document);
	});

	connection.onShutdown(() => {
		// cleanup
	});

	connection.onRequest("textDocument/semanticTokens/full", async (requestParams) => {
		try {
			const document = documents.get(requestParams.textDocument.uri);
			if (!document) {
				return { data: [] };
			}
			const metadata = documentMetadata.get(document);
			const tokens = tokenizeDocument(document.getText(), metadata.frontMatterEnd);

			// Build semantic tokens data array (relative encoding)
			const data: number[] = [];
			let prevLine = 0;
			let prevChar = 0;

			tokens.sort((a, b) => a.line - b.line || a.startChar - b.startChar);

			for (const token of tokens) {
				const deltaLine = token.line - prevLine;
				const deltaChar = deltaLine === 0 ? token.startChar - prevChar : token.startChar;
				data.push(deltaLine, deltaChar, token.length, token.tokenType, 0);
				prevLine = token.line;
				prevChar = token.startChar;
			}

			return { data };
		} catch (error) {
			logger.error(`Error computing semantic tokens: ${error}`);
			return { data: [] };
		}
	});

	const { basePath, yamlSchemaPath } = params.initializationOptions;

	if (!basePath || !yamlSchemaPath) {
		throw new Error("Initialization options 'basePath' and 'yamlSchemaPath' are required.");
	}

	options.basePath = basePath;
	options.yamlSchemaPath = yamlSchemaPath;

	// uri for the schema
	const schemaUri = URI.file(path.join(basePath, yamlSchemaPath)).toString();

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
			completionProvider: {
				resolveProvider: true,
				triggerCharacters: ["{", ":"],
			},
		},
	};
	return result;
});

connection.onCompletion(async (textDocumentPosition) => {
	try {
		const document = documents.get(textDocumentPosition.textDocument.uri);
		if (!document) {
			return null;
		}
		const metadata = documentMetadata.get(document);
		if (metadata.frontMatterStart === undefined || metadata.frontMatterEnd === undefined) {
			return null;
		}
		const { line } = textDocumentPosition.position;
		if (line <= metadata.frontMatterStart) {
			return null;
		} else if (line < metadata.frontMatterEnd) {
			const completion = await yamlLanguageServer.doComplete(document, textDocumentPosition.position, false);
			return completion;
		}
		return null;
	} catch (error) {
		logger.error(`Error during completion: ${error}`);
		return null;
	}
});

connection.onHover(async (textDocumentPosition) => {
	try {
		const document = documents.get(textDocumentPosition.textDocument.uri);
		if (!document) {
			return null;
		}
		const metadata = documentMetadata.get(document);
		if (metadata.frontMatterStart === undefined || metadata.frontMatterEnd === undefined) {
			return null;
		}
		const { line } = textDocumentPosition.position;
		if (line <= metadata.frontMatterStart) {
			return null;
		} else if (line < metadata.frontMatterEnd) {
			const hover = await yamlLanguageServer.doHover(document, textDocumentPosition.position);
			if (hover && hover.contents) {
				return hover;
			}
		}
		return null;
	} catch (error) {
		logger.error(`Error during hover: ${error}`);
		return null;
	}
});

connection.onDocumentOnTypeFormatting((_params) => {
	return null;
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
