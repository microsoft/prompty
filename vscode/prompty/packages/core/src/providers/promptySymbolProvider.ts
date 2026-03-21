import {
	CancellationToken,
	DocumentSymbol,
	DocumentSymbolProvider,
	ProviderResult,
	Range,
	SymbolKind,
	TextDocument
} from 'vscode';

export class PromptySymbolProvider implements DocumentSymbolProvider {
	provideDocumentSymbols(
		document: TextDocument,
		_token: CancellationToken
	): ProviderResult<DocumentSymbol[]> {
		const text = document.getText();
		const lines = text.split(/\n|\r\n/);
		const symbols: DocumentSymbol[] = [];

		let frontMatterStart: number | undefined;
		let frontMatterEnd: number | undefined;
		let inFrontMatter = false;

		// Find frontmatter boundaries
		for (let i = 0; i < lines.length; i++) {
			if (/^---\s*$/.test(lines[i])) {
				if (inFrontMatter) {
					frontMatterEnd = i;
					inFrontMatter = false;
				} else if (frontMatterStart === undefined) {
					frontMatterStart = i;
					inFrontMatter = true;
				}
			}
		}

		// Add frontmatter symbol
		if (frontMatterStart !== undefined && frontMatterEnd !== undefined) {
			const fmRange = new Range(frontMatterStart, 0, frontMatterEnd, lines[frontMatterEnd].length);
			const fmSymbol = new DocumentSymbol(
				'Frontmatter',
				'YAML configuration',
				SymbolKind.Namespace,
				fmRange,
				new Range(frontMatterStart, 0, frontMatterStart, 3)
			);

			fmSymbol.children = this.parseFrontmatterSymbols(lines, frontMatterStart + 1, frontMatterEnd);
			symbols.push(fmSymbol);
		}

		// Find role sections in body
		const bodyStart = (frontMatterEnd ?? -1) + 1;
		const roleRegex = /^\s*#?\s*(system|user|assistant|developer|tool|function)\s*(\[.*?\])?\s*:\s*$/i;
		let currentRole: { name: string; line: number } | undefined;

		for (let i = bodyStart; i < lines.length; i++) {
			const match = lines[i].match(roleRegex);
			if (match) {
				if (currentRole) {
					const endLine = this.findLastNonEmptyLine(lines, currentRole.line + 1, i - 1);
					const range = new Range(currentRole.line, 0, endLine, lines[endLine].length);
					symbols.push(new DocumentSymbol(
						currentRole.name,
						'role',
						SymbolKind.Function,
						range,
						new Range(currentRole.line, 0, currentRole.line, lines[currentRole.line].length)
					));
				}
				currentRole = { name: match[1].toLowerCase(), line: i };
			}
		}

		// Close last role
		if (currentRole) {
			const endLine = this.findLastNonEmptyLine(lines, currentRole.line + 1, lines.length - 1);
			const range = new Range(currentRole.line, 0, endLine, lines[endLine].length);
			symbols.push(new DocumentSymbol(
				currentRole.name,
				'role',
				SymbolKind.Function,
				range,
				new Range(currentRole.line, 0, currentRole.line, lines[currentRole.line].length)
			));
		}

		return symbols;
	}

	private parseFrontmatterSymbols(lines: string[], start: number, end: number): DocumentSymbol[] {
		const symbols: DocumentSymbol[] = [];
		const topLevelKeyRegex = /^(\w[\w-]*)\s*:/;

		for (let i = start; i < end; i++) {
			const match = lines[i].match(topLevelKeyRegex);
			if (match) {
				const key = match[1];
				let keyEnd = i;
				for (let j = i + 1; j < end; j++) {
					if (topLevelKeyRegex.test(lines[j])) {
						break;
					}
					keyEnd = j;
				}

				const kind = this.getSymbolKindForKey(key);
				const range = new Range(i, 0, keyEnd, lines[keyEnd].length);
				const selRange = new Range(i, 0, i, lines[i].length);
				symbols.push(new DocumentSymbol(key, '', kind, range, selRange));
			}
		}

		return symbols;
	}

	private getSymbolKindForKey(key: string): SymbolKind {
		switch (key) {
			case 'name': return SymbolKind.String;
			case 'description': return SymbolKind.String;
			case 'model': return SymbolKind.Object;
			case 'inputSchema': return SymbolKind.Interface;
			case 'outputSchema': return SymbolKind.Interface;
			case 'template': return SymbolKind.Object;
			case 'tools': return SymbolKind.Array;
			case 'metadata': return SymbolKind.Object;
			default: return SymbolKind.Property;
		}
	}

	private findLastNonEmptyLine(lines: string[], start: number, end: number): number {
		for (let i = end; i >= start; i--) {
			if (lines[i].trim().length > 0) {
				return i;
			}
		}
		return start;
	}
}