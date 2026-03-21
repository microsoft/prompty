// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SemanticTokensLegend } from "vscode-languageserver";

const tokenTypes: string[] = ["variable", "keyword", "string", "comment"];

export enum PromptySemanticTokenTypes {
	Variable = 0,
	Keyword = 1,
	String = 2,
	Comment = 3,
}

export function getSemanticTokenLegend(): SemanticTokensLegend {
	return {
		tokenTypes,
		tokenModifiers: [],
	};
}

export interface Token {
	line: number;
	startChar: number;
	length: number;
	tokenType: PromptySemanticTokenTypes;
}

export function tokenizeDocument(
	text: string,
	frontMatterEnd: number | undefined
): Token[] {
	const tokens: Token[] = [];
	const lines = text.split(/\n|\r\n/);

	const roleRegex = /^\s*#?\s*(system|user|assistant|developer|tool|function)\s*(\[.*?\])?\s*:\s*$/i;
	const templateVarRegex = /\{\{(\s*\w+(?:\.\w+)*\s*)\}\}/g;
	const envVarRegex = /\$\{env:(\w+)(?::([^}]*))?\}/g;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Process body section (after frontmatter) for roles and template variables
		if (frontMatterEnd !== undefined && i > frontMatterEnd) {
			const roleMatch = line.match(roleRegex);
			if (roleMatch) {
				const roleStart = line.indexOf(roleMatch[1]);
				tokens.push({
					line: i,
					startChar: roleStart,
					length: roleMatch[1].length + 1,
					tokenType: PromptySemanticTokenTypes.Keyword,
				});
			}

			let varMatch;
			while ((varMatch = templateVarRegex.exec(line)) !== null) {
				tokens.push({
					line: i,
					startChar: varMatch.index,
					length: varMatch[0].length,
					tokenType: PromptySemanticTokenTypes.Variable,
				});
			}
		}

		// Environment variable references in frontmatter
		if (frontMatterEnd === undefined || i <= frontMatterEnd) {
			let envMatch;
			while ((envMatch = envVarRegex.exec(line)) !== null) {
				tokens.push({
					line: i,
					startChar: envMatch.index,
					length: envMatch[0].length,
					tokenType: PromptySemanticTokenTypes.Variable,
				});
			}
		}
	}

	return tokens;
}