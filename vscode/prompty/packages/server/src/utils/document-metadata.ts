// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDocument } from "vscode-languageserver-textdocument";
import { Logger } from "./logger";

export interface DocumentMetadata {
	frontMatterStart?: number;
	frontMatterEnd?: number;
	variables: string[];
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
		//this.logger.debug(`Parsing document ${document.uri}...`);
		//console.log(`Parsing document ${document.uri}...`);
		const text = document.getText();
		const lines = text.split(/\n|\r\n/);
		let inFrontMatter = false;
		let frontMatterStart: number | undefined;
		let frontMatterEnd: number | undefined;
		for (let i = 0; i < lines.length; i++) {
			if (/^---$/.test(lines[i])) {
				if (inFrontMatter) {
					frontMatterEnd = i;
					inFrontMatter = false;
				} else {
					frontMatterStart = i;
					inFrontMatter = true;
				}
			}
		}
		//const metadata = { frontMatterStart, frontMatterEnd };
		//console.log(`Parsed document metadata: ${JSON.stringify(metadata)}`);
		return { frontMatterStart, frontMatterEnd, variables: [] };
	}

	public set(document: TextDocument) {
		this.logger.debug(`Setting metadata for document ${document.uri}...`);
		const metadata = this.parseDocument(document);

		this.store.set(document.uri, metadata);
	}

	public delete(uri: string) {
		this.store.delete(uri);
	}
}