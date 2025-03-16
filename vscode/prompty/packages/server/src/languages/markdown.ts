// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDocument } from "vscode-languageserver-textdocument";
import {
  CompletionItem,
  CompletionItemKind,
  Position,
  Range,
  SemanticTokens,
  SemanticTokensBuilder,
} from "vscode-languageserver/node";
import { CompletionProvider, SemanticTokenProvider } from "./index";
import { DocumentMetadata } from "../util/document-metadata";
import { jinjaTokens } from "./jinja";

export class MarkdownTokenProvider implements SemanticTokenProvider {
  private static instance?: MarkdownTokenProvider;

  private constructor() {}

  public static getInstance(): MarkdownTokenProvider {
    if (!MarkdownTokenProvider.instance) {
      MarkdownTokenProvider.instance = new MarkdownTokenProvider();
    }
    return MarkdownTokenProvider.instance;
  }

  full(document: TextDocument, range: Range): SemanticTokens {
    const builder = new SemanticTokensBuilder();
    const tokens = jinjaTokens(document.getText(range));
    const startIndex = document.offsetAt(range.start);
    tokens.forEach((token) => {
      const tokenPosition = document.positionAt(startIndex + token.startIndex);
      builder.push(tokenPosition.line, tokenPosition.character, token.length, token.token, 0);
    });
    return builder.build();
  }
}

export class MarkdownCompletionProvider implements CompletionProvider {
  private static instance?: CompletionProvider;

  private constructor() {}

  public static getInstance(): CompletionProvider {
    if (!MarkdownCompletionProvider.instance) {
      MarkdownCompletionProvider.instance = new MarkdownCompletionProvider();
    }
    return MarkdownCompletionProvider.instance;
  }

  provideCompletionItems(document: TextDocument, metadata: DocumentMetadata, position: Position) {
    if (!metadata.variables || metadata.variables.length === 0) {
      return null;
    }

    const lineText = document.getText({
      start: { line: position.line, character: 0 },
      end: position,
    });

    if (lineText.trim().endsWith("{{")) {
      const variables = metadata.variables;
      return variables.map((variable) => {
        const item = CompletionItem.create(variable);
        item.kind = CompletionItemKind.Variable;
        return item;
      });
    }

    return null;
  }
}
