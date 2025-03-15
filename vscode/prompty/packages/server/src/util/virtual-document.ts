// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Position, Range, TextDocument } from "vscode-languageserver-textdocument";

export interface FullTextDocument {
  getLineOffsets(): number[];
}

export class VirtualDocument implements TextDocument, FullTextDocument {
  private _document: TextDocument;
  private _lineStart: number;
  private _lineEnd: number;
  public uri: string;
  public languageId: string;
  public version: number;
  public lineCount: number;

  constructor(document: TextDocument, lineStart: number, lineEnd: number) {
    this._document = document;
    this._lineStart = lineStart;
    this._lineEnd = lineEnd;
    this.uri = document.uri;
    this.languageId = document.languageId;
    this.version = document.version;
    this.lineCount = lineEnd - lineStart;
  }

  toRealPosition(virtualPosition: Position): Position {
    return {
      line: virtualPosition.line + this._lineStart,
      character: virtualPosition.character,
    };
  }

  getLineOffsets(): number[] {
    const offsets = (this._document as unknown as FullTextDocument).getLineOffsets();
    const firstLineOffset = this._lineStart > 0 ? offsets[this._lineStart] : 0;
    return offsets
      .slice(this._lineStart, this._lineEnd + 1)
      .map((offset) => offset - firstLineOffset);
  }

  getText(range?: Range | undefined): string {
    const startLine = (range?.start?.line ?? 0) + this._lineStart;
    const endLine = (range?.end?.line ?? this.lineCount) + this._lineStart;
    const lastCharOfLastLine = this._document.getText({
      start: { line: endLine, character: 0 },
      end: { line: endLine + 1, character: 0 },
    }).length;
    const realRange: Range = {
      start: { line: startLine, character: range?.start?.character ?? 0 },
      end: { line: endLine, character: range?.end?.character ?? lastCharOfLastLine },
    };
    return this._document.getText(realRange);
  }

  positionAt(offset: number): Position {
    const startOffset = this._document.offsetAt({ line: this._lineStart, character: 0 });
    const realPosition = this._document.positionAt(startOffset + offset);
    return {
      line: realPosition.line - this._lineStart,
      character: realPosition.character,
    };
  }

  offsetAt(position: Position): number {
    const startOffset = this._document.offsetAt({ line: this._lineStart, character: 0 });
    const realPosition = { line: position.line + this._lineStart, character: position.character };
    return this._document.offsetAt(realPosition) - startOffset;
  }
}
