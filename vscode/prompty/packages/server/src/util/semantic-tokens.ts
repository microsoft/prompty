// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SemanticTokensLegend } from "vscode-languageserver";

const tokenTypes: string[] = ["variable", "keyword", "punctuation-begin", "punctuation-end"];

export enum PromptySemanticTokenTypes {
  Variable = 0,
  Keyword = 1,
  PunctuationTemplateBegin = 2,
  PunctuationTemplateEnd = 3,
}

export function getSemanticTokenLegend(): SemanticTokensLegend {
  return {
    tokenTypes,
    tokenModifiers: [],
  };
}

export interface Token {
  startIndex: number;
  length: number;
  token: PromptySemanticTokenTypes;
}
