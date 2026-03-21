// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SemanticTokensLegend } from "vscode-languageserver";

const tokenTypes: string[] = [
	"variable",    // 0 — template vars {{var}}, env vars ${env:VAR}
	"keyword",     // 1 — role names (system, user, assistant, ...)
	"string",      // 2 — attribute values, image alt text
	"comment",     // 3 — frontmatter delimiters ---
	"operator",    // 4 — role colon, attribute =, brackets
	"decorator",   // 5 — attribute keys in [key="value"]
	"type",        // 6 — thread markers ![thread]
];

export enum PromptySemanticTokenTypes {
	Variable = 0,
	Keyword = 1,
	String = 2,
	Comment = 3,
	Operator = 4,
	Decorator = 5,
	Type = 6,
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
	frontMatterStart: number | undefined,
	frontMatterEnd: number | undefined
): Token[] {
	const tokens: Token[] = [];
	const lines = text.split(/\n|\r\n/);

	const roleRegex = /^(\s*#?\s*)(system|user|assistant|developer|tool|function)(\[.*?\])?\s*(:)\s*$/i;
	const templateVarRegex = /\{\{(\s*\w+(?:\.\w+)*\s*)\}\}/g;
	const envVarRegex = /\$\{env:(\w+)(?::([^}]*))?\}/g;
	const threadRegex = /!\[\s*thread\s*\]/g;
	const attrRegex = /(\w+)\s*(=)\s*("?)([^",]*)("?)/g;
	const delimiterRegex = /^---\s*$/;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Frontmatter delimiters ---
		if (delimiterRegex.test(line) && (i === frontMatterStart || i === frontMatterEnd)) {
			tokens.push({
				line: i,
				startChar: 0,
				length: 3,
				tokenType: PromptySemanticTokenTypes.Comment,
			});
			continue;
		}

		// Thread markers ![thread]
		let threadMatch;
		while ((threadMatch = threadRegex.exec(line)) !== null) {
			tokens.push({
				line: i,
				startChar: threadMatch.index,
				length: threadMatch[0].length,
				tokenType: PromptySemanticTokenTypes.Type,
			});
		}

		// Body section (after frontmatter)
		if (frontMatterEnd !== undefined && i > frontMatterEnd) {
			const roleMatch = line.match(roleRegex);
			if (roleMatch) {
				const prefix = roleMatch[1];
				const roleName = roleMatch[2];
				const attrs = roleMatch[3]; // e.g. [name="Alice"]
				const colon = roleMatch[4];

				// Role name
				const roleStart = prefix.length;
				tokens.push({
					line: i,
					startChar: roleStart,
					length: roleName.length,
					tokenType: PromptySemanticTokenTypes.Keyword,
				});

				// Attribute brackets and contents
				if (attrs) {
					const bracketStart = roleStart + roleName.length;
					// Opening bracket
					tokens.push({
						line: i,
						startChar: bracketStart,
						length: 1,
						tokenType: PromptySemanticTokenTypes.Operator,
					});
					// Closing bracket
					tokens.push({
						line: i,
						startChar: bracketStart + attrs.length - 1,
						length: 1,
						tokenType: PromptySemanticTokenTypes.Operator,
					});
					// Parse individual attributes
					const innerAttrs = attrs.slice(1, -1);
					let am;
					const attrRe = new RegExp(attrRegex.source, attrRegex.flags);
					while ((am = attrRe.exec(innerAttrs)) !== null) {
						const offset = bracketStart + 1 + am.index;
						// Attribute key
						tokens.push({
							line: i,
							startChar: offset,
							length: am[1].length,
							tokenType: PromptySemanticTokenTypes.Decorator,
						});
						// = sign
						tokens.push({
							line: i,
							startChar: offset + am[1].length + (am[0].indexOf('=') - am[1].length),
							length: 1,
							tokenType: PromptySemanticTokenTypes.Operator,
						});
						// Attribute value
						const valStart = am[0].indexOf(am[4], am[0].indexOf('='));
						if (am[4].length > 0) {
							tokens.push({
								line: i,
								startChar: offset + valStart,
								length: am[4].length,
								tokenType: PromptySemanticTokenTypes.String,
							});
						}
					}
				}

				// Colon
				const colonPos = line.lastIndexOf(':');
				if (colonPos >= 0) {
					tokens.push({
						line: i,
						startChar: colonPos,
						length: 1,
						tokenType: PromptySemanticTokenTypes.Operator,
					});
				}
			}

			// Template variables {{var}} — highlight as a single variable token so they stand out
			let varMatch;
			while ((varMatch = templateVarRegex.exec(line)) !== null) {
				tokens.push({
					line: i,
					startChar: varMatch.index,
					length: varMatch[0].length,
					tokenType: PromptySemanticTokenTypes.Variable,
				});
			}

			// Env vars in body too
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

		// Environment variable references in frontmatter
		if (frontMatterEnd === undefined || (frontMatterStart !== undefined && i > frontMatterStart && i < frontMatterEnd)) {
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