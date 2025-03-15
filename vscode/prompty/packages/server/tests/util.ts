// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDocument } from "vscode-languageserver-textdocument";
import { Position, Range } from "yaml-language-server";
import { FullTextDocument } from "../out/util/virtual-document";

export function createTextDocument(text: string): TextDocument & FullTextDocument {
  const lines = text.split("\n");
  const offsetAt = (position: Position) =>
    lines.slice(0, position.line).reduce((prev, curr) => prev + curr.length + 1, 0) +
    position.character;
  return {
    uri: "mockUri",
    languageId: "markdown",
    version: 1,
    lineCount: lines.length,
    getText: (range?: Range) =>
      range ? text.slice(offsetAt(range.start), offsetAt(range.end)) : text,
    positionAt: (offset: number) => {
      const before = text.slice(0, offset);
      const newLines = (before.match(/\n/g) || []).length;
      const lineStart = before.lastIndexOf("\n") + 1;
      const character = offset - lineStart;
      return Position.create(newLines, character);
    },
    offsetAt,
    getLineOffsets: () => {
      return Array.from({ length: lines.length }, (_, i) => i).map((i) =>
        offsetAt(Position.create(i, 0))
      );
    },
  };
}
