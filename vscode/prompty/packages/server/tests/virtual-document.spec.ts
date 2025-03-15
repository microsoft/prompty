// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "vitest";
import { VirtualDocument } from "../src/util/virtual-document";
import { Range } from "vscode-languageserver-textdocument";
import { createTextDocument } from "./util";

const lines: string[] = [
  "Agile Antelope",
  "Brave Bear",
  "Clever Cheetah",
  "Daring Dolphin",
  "Energetic Elephant",
  "Fearless Falcon",
  "Gentle Giraffe",
  "Happy Hippo",
  "Inquisitive Iguana",
  "Joyful Jaguar",
  "Kind Kangaroo",
  "Lively Lion",
  "Mighty Monkey",
  "Noble Nightingale",
  "Optimistic Otter",
  "Playful Penguin",
  "Quick Quail",
  "Resilient Rabbit",
  "Strong Shark",
  "Trustworthy Turtle",
];

describe("VirtualDocument", () => {
  const document = createTextDocument(lines.join("\n"));

  const viewStart = 1;
  const viewEnd = 5;
  const virtualDocument = new VirtualDocument(document, viewStart, viewEnd);

  describe("getLineOffsets", () => {
    it("should get the right number of lines", () => {
      const offsets = virtualDocument.getLineOffsets();

      expect(offsets.length).toEqual(5 - 1 + 1);
    });

    it("should have the proper relative offsets", () => {
      const originalOffsets = document.getLineOffsets();
      const offsets = virtualDocument.getLineOffsets();

      const expected = originalOffsets
        .slice(viewStart, viewEnd + 1)
        .map((offset) => offset - originalOffsets[viewStart]);
      expect(offsets).toEqual(expected);
    });
  });

  describe("getText", () => {
    it("should correctly get all text", () => {
      const text = virtualDocument.getText();
      expect(text).toEqual(
        `Brave Bear\nClever Cheetah\nDaring Dolphin\nEnergetic Elephant\nFearless Falcon\n`
      );
    });
    it("should correctly get a range", () => {
      const range: Range = { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } };
      const text = virtualDocument.getText(range);

      expect(text).toEqual("Brave Bear\n");
    });
  });

  describe("positionAt", () => {
    it("should get the right position for line beginnings", () => {
      const lineOffsets = virtualDocument.getLineOffsets();

      const positions = lineOffsets.map((offset) => virtualDocument.positionAt(offset));
      const expected = lineOffsets.map((_, i) => ({ line: i, character: 0 }));
      expect(positions).toEqual(expected);
    });

    it("should get the right position for line endings", () => {
      const lineOffsets = virtualDocument.getLineOffsets();

      const positions = lineOffsets.map((offset, i) =>
        virtualDocument.positionAt(offset + lines[i + viewStart].length)
      );
      const expected = lineOffsets.map((_, i) => ({
        line: i,
        character: lines[i + viewStart].length,
      }));
      expect(positions).toEqual(expected);
    });
  });

  describe("offsetAt", () => {
    it("should have the right offset for the beginning of lines", () => {
      const lineOffsets = virtualDocument.getLineOffsets();
      const offsets = lineOffsets.map((_, i) =>
        virtualDocument.offsetAt({ line: i, character: 0 })
      );
      expect(offsets).toEqual(lineOffsets);
    });
  });

  describe("toRealPosition", () => {
    it("should return a position that references the same text", () => {
      const lineOffsets = virtualDocument.getLineOffsets();
      const virtualPositions = lineOffsets.map((offset) => virtualDocument.positionAt(offset));
      const realPositions = virtualPositions.map((position) =>
        virtualDocument.toRealPosition(position)
      );
      const textFromVirtual = virtualPositions.map((position, i) =>
        virtualDocument.getText({
          start: position,
          end: { line: position.line, character: lines[i + viewStart].length },
        })
      );
      const textFromReal = realPositions.map((position, i) =>
        document.getText({
          start: position,
          end: { line: position.line, character: lines[i + viewStart].length },
        })
      );
      expect(textFromReal).toEqual(textFromVirtual);
    });
  });
});
