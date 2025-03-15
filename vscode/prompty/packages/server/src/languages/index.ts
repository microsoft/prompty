// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionItem, Position, Range, SemanticTokens } from "vscode-languageserver";
import { MarkdownTokenProvider, MarkdownCompletionProvider } from "./markdown";
import { YAMLTokenProvider } from "./yaml";
import { DocumentMetadata } from "../util/document-metadata";

export interface SemanticTokenProvider {
  full(document: TextDocument, range: Range): SemanticTokens;
}

export interface CompletionProvider {
  provideCompletionItems(
    document: TextDocument,
    metadata: DocumentMetadata,
    position: Position
  ): CompletionItem[] | null;
}

export enum Language {
  YAML,
  Markdown,
}

export function getCompletionProvider(language: Language): CompletionProvider {
  switch (language) {
    case Language.Markdown:
      return MarkdownCompletionProvider.getInstance();
    default:
      throw new Error("Language not supported");
  }
}

export function getTokensProvider(language: Language): SemanticTokenProvider {
  switch (language) {
    case Language.YAML:
      return YAMLTokenProvider.getInstance();
    case Language.Markdown:
      return MarkdownTokenProvider.getInstance();
    default:
      throw new Error("Language not supported");
  }
}
