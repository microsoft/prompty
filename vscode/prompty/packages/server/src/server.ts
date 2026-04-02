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
	CompletionItem,
	CompletionItemKind,
	InsertTextFormat,
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

// Model completions cache — populated by client via prompty/modelsChanged notification
interface ModelEntry {
	id: string;
	displayName?: string;
	provider: string;
}
let availableModels: ModelEntry[] = [];

// Connection data cache — populated by client via prompty/connectionsChanged notification
interface ConnectionEntry {
	name: string;
	id: string;
	providerType: string;
	isDefault?: boolean;
}
let availableConnections: ConnectionEntry[] = [];
const KNOWN_PROVIDERS = new Set(["openai", "anthropic", "foundry", "azure"]);

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

/** Create a VirtualDocument that contains only the YAML frontmatter content (between --- delimiters). */
function createFrontMatterVirtualDocument(
	textDocument: TextDocument,
	metadata: DocumentMetadata
): VirtualDocument | null {
	if (metadata.frontMatterStart === undefined || metadata.frontMatterEnd === undefined) {
		return null;
	}
	return new VirtualDocument(
		textDocument,
		metadata.frontMatterStart + 1,
		metadata.frontMatterEnd - 1
	);
}

async function validateTextDocument(textDocument: TextDocument) {
	try {
		const metadata = documentMetadata.get(textDocument);
		if (metadata.frontMatterStart === undefined || metadata.frontMatterEnd === undefined) {
			return;
		}

		const virtualDocument = createFrontMatterVirtualDocument(textDocument, metadata);
		if (!virtualDocument) {
			return;
		}

		const allDiagnostics = await getYamlDiagnostics(virtualDocument);

		// Add parse errors
		for (const error of metadata.parseErrors) {
			allDiagnostics.push({
				severity: DiagnosticSeverity.Error,
				range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
				message: error,
				source: 'prompty',
			});
		}

		// Connection / provider validation (only when we have connection data)
		if (availableConnections.length > 0 || KNOWN_PROVIDERS.size > 0) {
			const connectionDiags = validateConnections(textDocument, metadata);
			allDiagnostics.push(...connectionDiags);
		}

		connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: allDiagnostics });
	} catch (error) {
		logger.error(`Error validating document: ${error}`);
	}
}

/**
 * Validates provider and connection references in the frontmatter.
 * Emits warnings for missing connections and errors for unknown providers.
 */
function validateConnections(
	document: TextDocument,
	metadata: DocumentMetadata,
): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const start = metadata.frontMatterStart ?? 0;
	const end = metadata.frontMatterEnd ?? 0;

	let providerLine: number | undefined;
	let providerValue: string | undefined;
	let providerValueStart = 0;
	let providerValueEnd = 0;

	let connectionKind: string | undefined;
	let refNameLine: number | undefined;
	let refNameValue: string | undefined;
	let refNameValueStart = 0;
	let refNameValueEnd = 0;

	// Scan frontmatter for provider: and connection fields
	for (let l = start + 1; l < end; l++) {
		const lineText = document.getText({
			start: { line: l, character: 0 },
			end: { line: l + 1, character: 0 },
		}).trimEnd();

		const providerMatch = lineText.match(/^(\s+)provider:\s*(\S+)/);
		if (providerMatch) {
			providerLine = l;
			providerValue = providerMatch[2];
			providerValueStart = lineText.indexOf(providerValue, providerMatch[1].length + 9);
			providerValueEnd = providerValueStart + providerValue.length;
		}

		const kindMatch = lineText.match(/^\s+kind:\s*(\S+)/);
		if (kindMatch && (kindMatch[1] === 'reference' || kindMatch[1] === 'key' || kindMatch[1] === 'anonymous')) {
			connectionKind = kindMatch[1];
		}

		const nameMatch = lineText.match(/^(\s+)name:\s*(\S+)/);
		if (nameMatch && connectionKind === 'reference') {
			refNameLine = l;
			refNameValue = nameMatch[2];
			refNameValueStart = lineText.indexOf(refNameValue, nameMatch[1].length + 5);
			refNameValueEnd = refNameValueStart + refNameValue.length;
		}
	}

	// Case 1: Unknown provider
	if (providerValue && providerLine !== undefined && !KNOWN_PROVIDERS.has(providerValue)) {
		diagnostics.push({
			severity: DiagnosticSeverity.Error,
			range: {
				start: { line: providerLine, character: providerValueStart },
				end: { line: providerLine, character: providerValueEnd },
			},
			message: `Unknown provider '${providerValue}'. Expected: openai, anthropic, foundry, or azure.`,
			source: 'prompty',
		});
	}

	// Case 2: Valid provider but no matching connections configured
	if (providerValue && providerLine !== undefined && KNOWN_PROVIDERS.has(providerValue)) {
		// Only warn if we have connection data (extension has sent it) and there are no matches
		// Treat 'azure' as alias for 'foundry'
		const normalizedProvider = providerValue === 'azure' ? 'foundry' : providerValue;
		const hasConnection = availableConnections.some(
			c => c.providerType === providerValue || c.providerType === normalizedProvider
		);
		// Skip warning if using an explicit key connection (self-contained, no sidebar connection needed)
		if (!hasConnection && connectionKind !== 'key' && availableConnections.length > 0) {
			diagnostics.push({
				severity: DiagnosticSeverity.Warning,
				range: {
					start: { line: providerLine, character: providerValueStart },
					end: { line: providerLine, character: providerValueEnd },
				},
				message: `No ${providerValue} connection configured. Add one in the Connections sidebar.`,
				source: 'prompty',
			});
		}
	}

	// Case 3: Reference connection name doesn't match any registered connection
	if (connectionKind === 'reference' && refNameValue && refNameLine !== undefined) {
		const hasNamedConnection = availableConnections.some(
			c => c.name === refNameValue || c.id === refNameValue
		);
		if (!hasNamedConnection && availableConnections.length > 0) {
			diagnostics.push({
				severity: DiagnosticSeverity.Warning,
				range: {
					start: { line: refNameLine, character: refNameValueStart },
					end: { line: refNameLine, character: refNameValueEnd },
				},
				message: `Connection '${refNameValue}' not found. Available: ${availableConnections.map(c => c.name).join(', ') || 'none'}`,
				source: 'prompty',
			});
		}
	}

	return diagnostics;
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
			const tokens = tokenizeDocument(document.getText(), metadata.frontMatterStart, metadata.frontMatterEnd);

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

// Receive model data from the extension client
connection.onNotification("prompty/modelsChanged", (params: { models: ModelEntry[] }) => {
	availableModels = params.models;
	logger.info(`Received ${availableModels.length} models for completion`);
});

// Receive connection data from the extension client
connection.onNotification("prompty/connectionsChanged", (params: { connections: ConnectionEntry[] }) => {
	availableConnections = params.connections;
	logger.info(`Received ${availableConnections.length} connections for validation`);
	// Re-validate all open documents when connections change
	for (const doc of documents.all()) {
		validateTextDocument(doc);
	}
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
		const { line, character } = textDocumentPosition.position;

		// Body section: complete {{input}} template variables from inputs
		if (line > metadata.frontMatterEnd) {
			const lineText = document.getText({
				start: { line, character: 0 },
				end: { line, character },
			});
			// Check if cursor is inside {{ ... (incomplete template variable)
			const templateContext = lineText.match(/\{\{\s*(\w*)$/);
			if (templateContext) {
				const partialName = templateContext[1];

				// Check what's after the cursor to avoid doubling }}
				const restOfLine = document.getText({
					start: { line, character },
					end: { line: line + 1, character: 0 },
				});
				const closingMatch = restOfLine.match(/^(\w*)\s*(\}\})?/);
				const trailingWord = closingMatch?.[1] ?? '';
				const hasClosingBraces = !!closingMatch?.[2];

				// Calculate replacement range: from start of partial name to end of existing text + braces
				const replaceStart = character - partialName.length;
				const replaceEnd = character + trailingWord.length + (hasClosingBraces ? 2 : 0);

				const inputNames = extractInputNames(document, metadata);
				const items: CompletionItem[] = inputNames
					.filter(({ name }) => name.startsWith(partialName))
					.map(({ name, description, kind: propKind }) => {
						const detail = propKind ? `(${propKind})` : '(input)';
						const suffix = hasClosingBraces ? '' : '}}';
						return {
							label: name,
							kind: CompletionItemKind.Variable,
							detail: `${detail} from inputs`,
							documentation: description || `Input variable '${name}' defined in frontmatter inputs.`,
							textEdit: {
								range: {
									start: { line, character: replaceStart },
									end: { line, character: replaceEnd },
								},
								newText: name + suffix,
							},
							sortText: `0_${name}`,
						};
					});
				return { isIncomplete: false, items };
			}
			return null;
		}

		// Frontmatter section: YAML completions
		if (line <= metadata.frontMatterStart) {
			return null;
		}

		// Use VirtualDocument so yaml-language-server only sees pure YAML
		const virtualDocument = createFrontMatterVirtualDocument(document, metadata);
		if (!virtualDocument) {
			return null;
		}
		const virtualPosition = virtualDocument.toVirtualPosition(textDocumentPosition.position);
		const completion = await yamlLanguageServer.doComplete(virtualDocument, virtualPosition, false);

		// Map completion edit ranges back to real document positions
		if (completion && completion.items) {
			for (const item of completion.items) {
				if (item.textEdit && 'range' in item.textEdit) {
					item.textEdit.range = {
						start: virtualDocument.toRealPosition(item.textEdit.range.start),
						end: virtualDocument.toRealPosition(item.textEdit.range.end),
					};
				}
			}
		}

		// Inject model ID completions when cursor is at model.id value
		if (availableModels.length > 0) {
			const modelIdContext = getModelIdContext(document, metadata, line, character);
			if (modelIdContext) {
				const { provider, replaceRange } = modelIdContext;
				const modelItems: CompletionItem[] = availableModels
					.filter(m => !provider || m.provider === provider)
					.map((m, i) => ({
						label: m.id,
						kind: CompletionItemKind.Value,
						detail: m.displayName ?? m.provider,
						documentation: `Model from ${m.provider} connection`,
						textEdit: {
							range: replaceRange,
							newText: ` ${m.id}`,
						},
						sortText: `0_${String(i).padStart(3, '0')}`,
					}));
				if (completion && completion.items) {
					completion.items.push(...modelItems);
				} else {
					return { isIncomplete: false, items: modelItems };
				}
			}
		}

		// Inject provider completions when cursor is at provider: value
		{
			const providerCtx = getProviderContext(document, metadata, line);
			if (providerCtx) {
				const providers = [...KNOWN_PROVIDERS];
				// Sort providers that have connections first
				const withConn = new Set(availableConnections.map(c => c.providerType));
				providers.sort((a, b) => {
					const aHas = withConn.has(a) ? 0 : 1;
					const bHas = withConn.has(b) ? 0 : 1;
					return aHas - bHas || a.localeCompare(b);
				});
				const providerItems: CompletionItem[] = providers.map((p, i) => ({
					label: p,
					kind: CompletionItemKind.EnumMember,
					detail: withConn.has(p) ? '● connected' : undefined,
					textEdit: {
						range: providerCtx.replaceRange,
						newText: ` ${p}`,
					},
					sortText: `0_${String(i).padStart(3, '0')}`,
				}));
				if (completion && completion.items) {
					completion.items.push(...providerItems);
				} else {
					return { isIncomplete: false, items: providerItems };
				}
			}
		}

		// Add snippet completions at root level (no indentation)
		const lineText = document.getText({
			start: { line, character: 0 },
			end: { line, character },
		});
		if (/^\s{0,1}\S{0,20}$/.test(lineText)) {
			const snippets = getPromptySnippets();
			if (completion && completion.items) {
				completion.items.push(...snippets);
			}
		}

		return completion;
	} catch (error) {
		logger.error(`Error during completion: ${error}`);
		return null;
	}
});

interface InputProperty {
	name: string;
	description: string;
	kind: string;
	defaultValue: string;
	example: string;
	required: boolean;
}

/** Infer a property kind from a JS value's type. */
function inferKind(value: unknown): string {
	switch (typeof value) {
		case 'string': return 'string';
		case 'number': return Number.isInteger(value) ? 'integer' : 'float';
		case 'boolean': return 'boolean';
		default:
			if (Array.isArray(value)) return 'array';
			if (value && typeof value === 'object') return 'object';
			return '';
	}
}

/** Build an InputProperty from raw parsed fields. Infers kind from default/example when not explicit. */
function toInputProperty(
	name: string,
	kind: unknown,
	description: unknown,
	defaultValue: unknown,
	example: unknown,
	required: unknown,
): InputProperty {
	const resolvedKind = kind ? String(kind) : inferKind(defaultValue ?? example);
	return {
		name,
		description: String(description ?? ''),
		kind: resolvedKind,
		defaultValue: defaultValue != null ? String(defaultValue) : '',
		example: example != null ? String(example) : '',
		required: Boolean(required),
	};
}

/** Extract input property names from the parsed frontmatter inputs section. */
function extractInputNames(
	_document: TextDocument,
	metadata: DocumentMetadata
): InputProperty[] {
	const content = metadata.frontMatterContent;
	if (!content) {
		return [];
	}

	const inputs = content['inputs'] ?? content['inputSchema'];
	if (!inputs) {
		return [];
	}

	const results: InputProperty[] = [];

	if (Array.isArray(inputs)) {
		// Array format: inputs: [{ name: "foo", kind: "string", ... }]
		for (const item of inputs) {
			if (item && typeof item === 'object' && 'name' in item) {
				results.push(toInputProperty(
					String(item.name ?? ''),
					item.kind,
					item.description,
					item.default,
					item.example,
					item.required,
				));
			}
		}
	} else if (typeof inputs === 'object' && inputs !== null) {
		// Record format: inputs: { foo: { kind: "string", ... } }
		for (const [name, value] of Object.entries(inputs)) {
			if (name === 'properties' && Array.isArray(value)) {
				// Legacy inputSchema.properties array
				for (const item of value) {
					if (item && typeof item === 'object' && 'name' in item) {
						results.push(toInputProperty(
							String(item.name ?? ''),
							item.kind,
							item.description,
							item.default,
							item.example,
							item.required,
						));
					}
				}
				return results;
			}
			if (value && typeof value === 'object') {
				const v = value as Record<string, unknown>;
				results.push(toInputProperty(name, v.kind, v.description, v.default, v.example, v.required));
			} else {
				// Shorthand: inputs: { foo: "example value" }
				results.push(toInputProperty(name, undefined, undefined, undefined, value, false));
			}
		}
	}

	return results;
}

function getPromptySnippets(): CompletionItem[] {
	return [
		{
			label: 'model (full)',
			kind: CompletionItemKind.Snippet,
			insertTextFormat: InsertTextFormat.Snippet,
			insertText: [
				'model:',
				'  id: ${1:gpt-4o}',
				'  provider: ${2|openai,azure,anthropic|}',
				'  apiType: ${3|chat,responses|}',
				'  connection:',
				'    kind: ${4|key,reference,remote,anonymous|}',
				'    endpoint: ${5:https://api.openai.com/v1}',
				'    apiKey: \\${env:${6:OPENAI_API_KEY}}',
				'  options:',
				'    temperature: ${7:0.7}',
				'    maxOutputTokens: ${8:1000}',
			].join('\n'),
			detail: 'Full model configuration with connection and options',
			documentation: 'Inserts a complete model block with provider, connection, and inference options.',
			sortText: '0_model_full',
		},
		{
			label: 'model (shorthand)',
			kind: CompletionItemKind.Snippet,
			insertTextFormat: InsertTextFormat.Snippet,
			insertText: 'model: ${1:gpt-4o}',
			detail: 'Shorthand: model: <model-id>',
			documentation: 'Shorthand model definition. Equivalent to model: { id: "<model-id>" }.',
			sortText: '0_model_short',
		},
		{
			label: 'inputs',
			kind: CompletionItemKind.Snippet,
			insertTextFormat: InsertTextFormat.Snippet,
			insertText: [
				'inputs:',
				'  - name: ${1:input_name}',
				'    kind: ${2|string,integer,float,boolean,object,array|}',
				'    description: ${3:Description}',
				'    default: ${4:default_value}',
			].join('\n'),
			detail: 'Input parameters',
			documentation: 'Defines typed input parameters with defaults for template rendering.',
			sortText: '0_inputs',
		},
		{
			label: 'template (shorthand)',
			kind: CompletionItemKind.Snippet,
			insertTextFormat: InsertTextFormat.Snippet,
			insertText: [
				'template:',
				'  format: ${1|jinja2,mustache|}',
				'  parser: ${2|prompty|}',
			].join('\n'),
			detail: 'Template config with string shorthand',
			documentation: 'Shorthand template config. "jinja2" expands to { kind: "jinja2" }.',
			sortText: '0_template_short',
		},
		{
			label: 'template (full)',
			kind: CompletionItemKind.Snippet,
			insertTextFormat: InsertTextFormat.Snippet,
			insertText: [
				'template:',
				'  format:',
				'    kind: ${1|jinja2,mustache|}',
				'    strict: ${2|false,true|}',
				'  parser:',
				'    kind: ${3|prompty|}',
			].join('\n'),
			detail: 'Full template configuration with options',
			documentation: 'Configures the template rendering engine and body parser with full object syntax.',
			sortText: '0_template_full',
		},
		{
			label: 'tools (function)',
			kind: CompletionItemKind.Snippet,
			insertTextFormat: InsertTextFormat.Snippet,
			insertText: [
				'tools:',
				'  - name: ${1:function_name}',
				'    kind: function',
				'    description: ${2:What the function does}',
				'    parameters:',
				'      properties:',
				'        - name: ${3:param_name}',
				'          kind: ${4|string,number,boolean,object,array|}',
				'          description: ${5:Parameter description}',
			].join('\n'),
			detail: 'Function tool definition',
			documentation: 'Defines a function tool the model can call during execution.',
			sortText: '0_tools_function',
		},
		{
			label: 'metadata',
			kind: CompletionItemKind.Snippet,
			insertTextFormat: InsertTextFormat.Snippet,
			insertText: [
				'metadata:',
				'  authors:',
				'    - ${1:author}',
				'  tags:',
				'    - ${2:tag}',
				'  version: ${3:1.0}',
			].join('\n'),
			detail: 'Prompt metadata (authors, tags, version)',
			documentation: 'Free-form metadata about the prompt.',
			sortText: '0_metadata',
		},
		{
			label: 'instructions',
			kind: CompletionItemKind.Snippet,
			insertTextFormat: InsertTextFormat.Snippet,
			insertText: 'instructions: ${1:Give your agent clear directions on what to do}',
			detail: 'Agent instructions (pure YAML, no markdown body needed)',
			documentation: 'Instructions for the agent. Use this instead of the markdown body for pure YAML declarations.',
			sortText: '0_instructions',
		},
	];
}

/**
 * Computes a replace range for a YAML value, ensuring exactly one space after the colon.
 * The range starts right after the colon, covering any existing whitespace + value.
 * newText should always be " value" (with leading space) to guarantee `key: value` formatting.
 */
function yamlValueRange(
	lineText: string,
	line: number,
	colonPos: number,
): { start: { line: number; character: number }; end: { line: number; character: number } } {
	// Replace everything after the colon (space + value) so we always get exactly ": value"
	const afterColon = colonPos + 1;
	const lineEnd = lineText.trimEnd().length;
	return {
		start: { line, character: afterColon },
		end: { line, character: Math.max(afterColon, lineEnd) },
	};
}

/**
 * Detects if the cursor is on a `model.id` value line in frontmatter.
 * Returns the current provider (if found) and a text edit range for the value.
 */
function getModelIdContext(
	document: TextDocument,
	metadata: DocumentMetadata,
	line: number,
	character: number,
): { provider: string | undefined; replaceRange: { start: { line: number; character: number }; end: { line: number; character: number } } } | null {
	const lineText = document.getText({
		start: { line, character: 0 },
		end: { line: line + 1, character: 0 },
	}).trimEnd();

	// Match "  id: <value>" (indented under model:) or shorthand "model: <value>"
	const idMatch = lineText.match(/^(\s+)id:/);
	const shorthandMatch = !idMatch ? lineText.match(/^model:/) : null;

	if (!idMatch && !shorthandMatch) return null;

	const colonPos = shorthandMatch
		? lineText.indexOf(':')
		: lineText.indexOf(':', idMatch![1].length);

	const replaceRange = yamlValueRange(lineText, line, colonPos);

	if (shorthandMatch) {
		return { provider: undefined, replaceRange };
	}

	// Walk upward/downward to find provider: at the same indent level
	const indent = idMatch![1];
	let provider: string | undefined;
	const scanRange = [
		{ from: line - 1, to: metadata.frontMatterStart ?? 0, step: -1 },
		{ from: line + 1, to: metadata.frontMatterEnd ?? line, step: 1 },
	];
	for (const { from, to, step } of scanRange) {
		if (provider) break;
		for (let l = from; step < 0 ? l > to : l < to; l += step) {
			const prevLine = document.getText({
				start: { line: l, character: 0 },
				end: { line: l + 1, character: 0 },
			}).trimEnd();
			const providerMatch = prevLine.match(new RegExp(`^${indent}provider:\\s*(\\S+)`));
			if (providerMatch) {
				provider = providerMatch[1];
				break;
			}
			if (prevLine.trim() && !prevLine.startsWith(indent)) break;
		}
	}

	return { provider, replaceRange };
}

/**
 * Detects if the cursor is on a `provider:` value line in frontmatter.
 * Returns a replace range for the value.
 */
function getProviderContext(
	document: TextDocument,
	metadata: DocumentMetadata,
	line: number,
): { replaceRange: { start: { line: number; character: number }; end: { line: number; character: number } } } | null {
	if (metadata.frontMatterStart === undefined || metadata.frontMatterEnd === undefined) return null;
	if (line <= metadata.frontMatterStart || line >= metadata.frontMatterEnd) return null;

	const lineText = document.getText({
		start: { line, character: 0 },
		end: { line: line + 1, character: 0 },
	}).trimEnd();

	const match = lineText.match(/^(\s+)provider:/);
	if (!match) return null;

	const colonPos = lineText.indexOf(':', match[1].length);
	return {
		replaceRange: yamlValueRange(lineText, line, colonPos),
	};
}

connection.onCompletionResolve((item) => {
	return item;
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
		const { line, character } = textDocumentPosition.position;

		// Body section: hover on {{template variables}}
		if (line > metadata.frontMatterEnd) {
			const lineText = document.getText({
				start: { line, character: 0 },
				end: { line: line + 1, character: 0 },
			}).trimEnd();
			return getTemplateVariableHover(lineText, character, line, document, metadata);
		}

		if (line <= metadata.frontMatterStart) {
			return null;
		}

		// Frontmatter: check for custom hover on known key: value pairs
		const lineText = document.getText({
			start: { line, character: 0 },
			end: { line: line + 1, character: 0 },
		}).trimEnd();

		const customHover = getValueHover(lineText, character, line);
		if (customHover) {
			return customHover;
		}

		const virtualDocument = createFrontMatterVirtualDocument(document, metadata);
		if (!virtualDocument) {
			return null;
		}
		const virtualPosition = virtualDocument.toVirtualPosition(textDocumentPosition.position);
		const hover = await yamlLanguageServer.doHover(virtualDocument, virtualPosition);
		if (hover && hover.contents) {
			if (hover.range) {
				hover.range = {
					start: virtualDocument.toRealPosition(hover.range.start),
					end: virtualDocument.toRealPosition(hover.range.end),
				};
			}
			return hover;
		}
		return null;
	} catch (error) {
		logger.error(`Error during hover: ${error}`);
		return null;
	}
});

/** Hover for {{variable}} tokens in the body — shows input type, description, and default. */
function getTemplateVariableHover(
	lineText: string,
	character: number,
	line: number,
	document: TextDocument,
	metadata: DocumentMetadata,
) {
	// Find all {{var}} on this line and check if cursor is inside one
	const varRegex = /\{\{\s*(\w+(?:\.\w+)*)\s*\}\}/g;
	let match;
	while ((match = varRegex.exec(lineText)) !== null) {
		const start = match.index;
		const end = start + match[0].length;
		if (character >= start && character <= end) {
			const varName = match[1];

			// Look up in inputs
			const inputs = extractInputNames(document, metadata);
			const input = inputs.find(i => i.name === varName);

			let md: string;
			if (input) {
				const parts = [`### \`{{${varName}}}\``];
				parts.push(`**Type:** \`${input.kind || 'any'}\``);
				if (input.description) {
					parts.push(input.description);
				}
				if (input.defaultValue !== undefined && input.defaultValue !== '') {
					parts.push(`**Default:** \`${input.defaultValue}\``);
				}
				if (input.example !== undefined && input.example !== '') {
					parts.push(`**Example:** \`${input.example}\``);
				}
				if (input.required) {
					parts.push('*Required*');
				}
				parts.push('\n---\n*Defined in frontmatter `inputs`*');
				md = parts.join('\n\n');
			} else {
				md = `### \`{{${varName}}}\`\n\nTemplate variable — not found in \`inputs\`. Make sure it is defined in the frontmatter.`;
			}

			return {
				contents: { kind: 'markdown' as const, value: md },
				range: {
					start: { line, character: start },
					end: { line, character: end },
				},
			};
		}
	}
	return null;
}

/**
 * Provides hover descriptions for shorthand and enum values in the frontmatter.
 * Matches `key: value` patterns and returns a description if the cursor is over the value.
 */
function getValueHover(lineText: string, character: number, line: number) {
	const kvMatch = lineText.match(/^(\s*)([\w-]+)\s*:\s*(.+?)\s*$/);
	if (!kvMatch) {
		return null;
	}
	const [, indent, key, value] = kvMatch;
	const valueStart = lineText.indexOf(value, indent.length + key.length + 1);
	const valueEnd = valueStart + value.length;

	if (character < valueStart || character > valueEnd) {
		return null;
	}

	const desc = VALUE_DESCRIPTIONS[key]?.[value];
	if (!desc) {
		return null;
	}

	return {
		contents: { kind: 'markdown' as const, value: `**\`${value}\`** — ${desc}` },
		range: {
			start: { line, character: valueStart },
			end: { line, character: valueEnd },
		},
	};
}

/** Descriptions for known values, keyed by property name then value. */
const VALUE_DESCRIPTIONS: Record<string, Record<string, string>> = {
	kind: {
		// Agent kinds
		prompt: 'A prompt-based agent that uses template rendering and model invocation.',
		hosted: 'A hosted agent running as an external service.',
		workflow: 'A workflow agent that orchestrates multiple steps or sub-agents.',
		// Connection kinds
		key: 'Authenticate with an explicit API key and endpoint. Use `${env:VAR}` to reference environment variables.',
		reference: 'Look up a pre-registered connection by name from the connection registry.',
		remote: 'Connect to a remote AI service endpoint with delegated authentication.',
		anonymous: 'Use default or environment-provided credentials without explicit keys.',
		// Tool kinds
		function: 'A function tool whose parameters are defined inline. Converted to the provider\'s function-calling wire format.',
		openapi: 'A tool backed by an OpenAPI specification. Operations are resolved from the spec.',
		mcp: 'A tool provided by a Model Context Protocol (MCP) server.',
		custom: 'A custom tool with arbitrary configuration for provider-specific or user-defined types.',
		web_search: 'A web search tool for retrieving information from the internet.',
		file_search: 'A file search / retrieval tool for searching through uploaded files.',
		code_interpreter: 'A code interpreter tool that can execute code in a sandboxed environment.',
		// Property kinds
		string: 'Text value (e.g. a question, name, or free-form input).',
		integer: 'Whole number value (e.g. count, index).',
		float: 'Decimal number value (e.g. temperature, score).',
		boolean: 'True/false value (e.g. a flag or toggle).',
		array: 'A list of values.',
		object: 'A structured key-value object.',
	},
	format: {
		jinja2: 'Jinja2 template engine — Python-style syntax with filters and control flow.',
		mustache: 'Mustache — logic-less templates with `{{variable}}` syntax.',
		handlebars: 'Handlebars — extends Mustache with helpers and block expressions.',
		nunjucks: 'Nunjucks — JavaScript port of Jinja2 with full feature parity.',
	},
	parser: {
		prompty: 'Prompty parser — splits template output into role-based messages using role markers (`system:`, `user:`, etc.).',
		plain: 'Plain parser — passes the rendered template through as a single string with no role splitting.',
	},
	provider: {
		openai: 'OpenAI API (`api.openai.com`).',
		azure: 'Azure OpenAI Service (`*.openai.azure.com`).',
		anthropic: 'Anthropic Claude API (`api.anthropic.com`).',
	},
	apiType: {
		chat: 'Chat completions API — send messages, get assistant responses.',
		responses: 'Responses API — newer stateful API with built-in tool handling.',
	},
	authenticationMode: {
		system: 'The system (application) authenticates on behalf of the user.',
		user: 'The user authenticates directly (e.g. interactive OAuth flow).',
	},
};

connection.onDocumentOnTypeFormatting((_params) => {
	return null;
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
