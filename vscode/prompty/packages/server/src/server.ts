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

		// Body section: complete {{input}} template variables from inputSchema
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
							detail: `${detail} from inputSchema`,
							documentation: description || `Input variable '${name}' defined in frontmatter inputSchema.`,
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
	required: boolean;
}

/** Extract input property names from the frontmatter inputSchema section. */
function extractInputNames(
	document: TextDocument,
	metadata: DocumentMetadata
): InputProperty[] {
	if (metadata.frontMatterStart === undefined || metadata.frontMatterEnd === undefined) {
		return [];
	}

	const text = document.getText({
		start: { line: metadata.frontMatterStart + 1, character: 0 },
		end: { line: metadata.frontMatterEnd, character: 0 },
	});

	const results: InputProperty[] = [];
	const lines = text.split(/\n|\r\n/);
	let inInputSchema = false;
	let inProperties = false;
	let currentName = '';
	let currentDescription = '';
	let currentKind = '';
	let currentDefault = '';
	let currentRequired = false;

	const flushProperty = () => {
		if (currentName) {
			results.push({
				name: currentName,
				description: currentDescription,
				kind: currentKind,
				defaultValue: currentDefault,
				required: currentRequired,
			});
		}
		currentName = '';
		currentDescription = '';
		currentKind = '';
		currentDefault = '';
		currentRequired = false;
	};

	for (const line of lines) {
		const trimmed = line.trimStart();

		// Detect inputSchema: section
		if (/^inputSchema\s*:/.test(trimmed)) {
			inInputSchema = true;
			inProperties = false;
			continue;
		}

		// Exit inputSchema when we hit another top-level key
		if (inInputSchema && /^\S/.test(line) && !/^\s/.test(line)) {
			flushProperty();
			inInputSchema = false;
			inProperties = false;
			continue;
		}

		if (inInputSchema) {
			if (/^\s+properties\s*:/.test(line)) {
				inProperties = true;
				continue;
			}

			if (inProperties) {
				// New property item: "- name: xxx"
				const nameMatch = trimmed.match(/^-\s*name\s*:\s*(.+)/);
				if (nameMatch) {
					flushProperty();
					currentName = nameMatch[1].trim().replace(/^["']|["']$/g, '');
					continue;
				}

				// Property fields on subsequent lines
				const descMatch = trimmed.match(/^description\s*:\s*(.+)/);
				if (descMatch && currentName) {
					currentDescription = descMatch[1].trim().replace(/^["']|["']$/g, '');
					continue;
				}

				const kindMatch = trimmed.match(/^kind\s*:\s*(.+)/);
				if (kindMatch && currentName) {
					currentKind = kindMatch[1].trim().replace(/^["']|["']$/g, '');
					continue;
				}

				const defaultMatch = trimmed.match(/^default\s*:\s*(.+)/);
				if (defaultMatch && currentName) {
					currentDefault = defaultMatch[1].trim().replace(/^["']|["']$/g, '');
					continue;
				}

				const reqMatch = trimmed.match(/^required\s*:\s*(.+)/);
				if (reqMatch && currentName) {
					currentRequired = reqMatch[1].trim().toLowerCase() === 'true';
					continue;
				}
			}
		}
	}

	flushProperty();
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
			label: 'inputSchema',
			kind: CompletionItemKind.Snippet,
			insertTextFormat: InsertTextFormat.Snippet,
			insertText: [
				'inputSchema:',
				'  properties:',
				'    - name: ${1:input_name}',
				'      kind: ${2|string,integer,float,boolean,object,array|}',
				'      description: ${3:Description}',
				'      default: ${4:default_value}',
			].join('\n'),
			detail: 'Input parameter schema',
			documentation: 'Defines typed input parameters with defaults for template rendering.',
			sortText: '0_inputSchema',
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

			// Look up in inputSchema
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
				if (input.required) {
					parts.push('*Required*');
				}
				parts.push('\n---\n*Defined in frontmatter `inputSchema`*');
				md = parts.join('\n\n');
			} else {
				md = `### \`{{${varName}}}\`\n\nTemplate variable — not found in \`inputSchema\`. Make sure it is defined in the frontmatter.`;
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
