// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MarkdownTokenProvider, MarkdownCompletionProvider } from "../src/languages/markdown";
import { Position, Range } from "vscode-languageserver";
import { expect, test, describe, it } from "vitest";
import { PromptySemanticTokenTypes } from "../src/util/semantic-tokens";
import { createTextDocument } from "./util";

test("MarkdownTokenProvider", () => {
  const provider = MarkdownTokenProvider.getInstance();

  const mockDocument = createTextDocument(
    `Line 1
Line 2
{{variable1}}
Line 4
{{variable2}}Line 6`
  );

  const mockRange: Range = {
    start: Position.create(0, 0),
    end: Position.create(6, 5),
  };

  // Test semanticTokens
  const semanticTokens = provider.full(mockDocument, mockRange);
  expect(semanticTokens.data).toEqual([
    2,
    0,
    2,
    PromptySemanticTokenTypes.PunctuationTemplateBegin,
    0, // {{ on line 2
    0,
    2,
    9,
    PromptySemanticTokenTypes.Variable,
    0, // variable1 on line 2
    0,
    9,
    2,
    PromptySemanticTokenTypes.PunctuationTemplateEnd,
    0, // }} on line 2
    2,
    0,
    2,
    PromptySemanticTokenTypes.PunctuationTemplateBegin,
    0, // {{ on line 4
    0,
    2,
    9,
    PromptySemanticTokenTypes.Variable,
    0, // variable2 on line 4
    0,
    9,
    2,
    PromptySemanticTokenTypes.PunctuationTemplateEnd,
    0, // }} on line 4
  ]);
});

describe("MarkdownCompletionProvider", () => {
  const provider = MarkdownCompletionProvider.getInstance();

  describe("when there are no variables", () => {
    it("should not generate any completions", () => {
      const mockDocument = createTextDocument("Line 1\nLine 2\n{{\nLine 4");
      const mockPosition = Position.create(2, 2);
      const mockMetadata = { variables: [] };
      const completionItems = provider.provideCompletionItems(
        mockDocument,
        mockMetadata,
        mockPosition
      );
      expect(completionItems).toBeNull();
    });
  });

  describe("when the preceding text is not {{", () => {
    it("should not generate any completions", () => {
      const mockDocument = createTextDocument("Line 1\nLine 2\nLine 3\nLine 4");
      const mockPosition = Position.create(2, 6);
      const mockMetadata = { variables: ["variable1", "variable2"] };
      const completionItems = provider.provideCompletionItems(
        mockDocument,
        mockMetadata,
        mockPosition
      );
      expect(completionItems).toBeNull();
    });
  });

  describe("when there are variables and the preceding text is {{", () => {
    it("should generate completions", () => {
      const mockDocument = createTextDocument("Line 1\nLine 2\n{{\nLine 4");
      const mockPosition = Position.create(2, 2);
      const mockMetadata = { variables: ["variable1", "variable2"] };
      const completionItems = provider.provideCompletionItems(
        mockDocument,
        mockMetadata,
        mockPosition
      );
      expect(completionItems).toHaveLength(2);
      expect(completionItems![0].label).toBe("variable1");
      expect(completionItems![1].label).toBe("variable2");
    });
  });
});
