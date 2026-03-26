// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDocument } from "vscode-languageserver-textdocument";
import { parse as parseYamlContent } from "yaml";
import { Logger } from "./logger";

export interface DocumentMetadata {
	frontMatterStart?: number;
	frontMatterEnd?: number;
	frontMatterContent?: Record<string, unknown>;
	roles: { name: string; line: number; endLine: number }[];
	templateVariables: { name: string; line: number; startChar: number; endChar: number }[];
	parseErrors: string[];
}

export class DocumentMetadataStore {
	private readonly store = new Map<string, DocumentMetadata>();
	private readonly logger: Logger;

	constructor(logger: Logger) {
		this.logger = logger;
	}

	public get(document: TextDocument): DocumentMetadata {
		const found = this.store.get(document.uri);
		if (found) {
			return found;
		}
		const metadata = this.parseDocument(document);
		this.store.set(document.uri, metadata);
		return metadata;
	}

	private parseDocument(document: TextDocument): DocumentMetadata {
		const text = document.getText();
		const lines = text.split(/\n|\r\n/);
		let inFrontMatter = false;
		let frontMatterStart: number | undefined;
		let frontMatterEnd: number | undefined;
		const roles: DocumentMetadata['roles'] = [];
		const templateVariables: DocumentMetadata['templateVariables'] = [];
		const parseErrors: string[] = [];

		const roleRegex = /^\s*#?\s*(system|user|assistant|developer|tool|function)\s*(\[.*?\])?\s*:\s*$/i;
		const templateVarRegex = /\{\{(\s*\w+(?:\.\w+)*\s*)\}\}/g;

		let currentRoleStart: number | undefined;
		let currentRoleName: string | undefined;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Detect frontmatter boundaries
			if (/^---\s*$/.test(line)) {
				if (inFrontMatter) {
					frontMatterEnd = i;
					inFrontMatter = false;
				} else if (frontMatterStart === undefined) {
					frontMatterStart = i;
					inFrontMatter = true;
				}
				continue;
			}

			// Scan body (after frontmatter) for roles and template variables
			if (frontMatterEnd !== undefined && i > frontMatterEnd) {
				const roleMatch = line.match(roleRegex);
				if (roleMatch) {
					if (currentRoleName !== undefined && currentRoleStart !== undefined) {
						roles.push({ name: currentRoleName, line: currentRoleStart, endLine: i - 1 });
					}
					currentRoleName = roleMatch[1].toLowerCase();
					currentRoleStart = i;
				}

				let varMatch;
				while ((varMatch = templateVarRegex.exec(line)) !== null) {
					templateVariables.push({
						name: varMatch[1].trim(),
						line: i,
						startChar: varMatch.index,
						endChar: varMatch.index + varMatch[0].length,
					});
				}
			}
		}

		// Close last role section
		if (currentRoleName !== undefined && currentRoleStart !== undefined) {
			roles.push({ name: currentRoleName, line: currentRoleStart, endLine: lines.length - 1 });
		}

		// Parse frontmatter YAML content
		let frontMatterContent: Record<string, unknown> | undefined;
		if (frontMatterStart !== undefined && frontMatterEnd !== undefined) {
			const yamlContent = lines.slice(frontMatterStart + 1, frontMatterEnd).join('\n');
			try {
				const parsed = this.parseYaml(yamlContent);
				if (parsed && typeof parsed === 'object') {
					frontMatterContent = parsed as Record<string, unknown>;
				}
			} catch (e) {
				parseErrors.push(`Failed to parse frontmatter YAML: ${e}`);
			}
		}

		return { frontMatterStart, frontMatterEnd, frontMatterContent, roles, templateVariables, parseErrors };
	}

	private parseYaml(content: string): unknown {
		try {
			return parseYamlContent(content);
		} catch {
			return undefined;
		}
	}

	public set(document: TextDocument) {
		const metadata = this.parseDocument(document);
		this.store.set(document.uri, metadata);
	}

	public delete(uri: string) {
		this.store.delete(uri);
	}
}