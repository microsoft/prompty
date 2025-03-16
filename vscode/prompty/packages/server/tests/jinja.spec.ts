// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, it, expect } from "vitest";
import { jinjaTokens } from "../src/languages/jinja";
import { PromptySemanticTokenTypes, Token } from "../src/util/semantic-tokens";

function getTokenText(text: string, token: Token): [string, PromptySemanticTokenTypes] {
  return [text.slice(token.startIndex, token.startIndex + token.length), token.token];
}

describe("jinja2 parsing", () => {
  describe("variables", () => {
    it("should correctly tokenize a single variable", () => {
      const text = "{{ variable }}";
      const tokens: Token[] = jinjaTokens(text);
      expect(tokens.length).toBe(3);
      expect(getTokenText(text, tokens[0])).toEqual([
        "{{",
        PromptySemanticTokenTypes.PunctuationTemplateBegin,
      ]);
      expect(getTokenText(text, tokens[1])).toEqual([
        "variable",
        PromptySemanticTokenTypes.Variable,
      ]);
      expect(getTokenText(text, tokens[2])).toEqual([
        "}}",
        PromptySemanticTokenTypes.PunctuationTemplateEnd,
      ]);
    });

    it("should correctly tokenize multiple variables", () => {
      const text = "{{ variable1 }} some text {{ variable2 }}";
      const tokens: Token[] = jinjaTokens(text);
      expect(getTokenText(text, tokens[0])).toEqual([
        "{{",
        PromptySemanticTokenTypes.PunctuationTemplateBegin,
      ]);
      expect(getTokenText(text, tokens[1])).toEqual([
        "variable1",
        PromptySemanticTokenTypes.Variable,
      ]);
      expect(getTokenText(text, tokens[2])).toEqual([
        "}}",
        PromptySemanticTokenTypes.PunctuationTemplateEnd,
      ]);
      expect(getTokenText(text, tokens[3])).toEqual([
        "{{",
        PromptySemanticTokenTypes.PunctuationTemplateBegin,
      ]);
      expect(getTokenText(text, tokens[4])).toEqual([
        "variable2",
        PromptySemanticTokenTypes.Variable,
      ]);
      expect(getTokenText(text, tokens[5])).toEqual([
        "}}",
        PromptySemanticTokenTypes.PunctuationTemplateEnd,
      ]);
    });

    it("should correctly tokenize variables across multiple lines", () => {
      const text = "{{ variable1 }}\nsome text\n{{ variable2 }}";
      const tokens: Token[] = jinjaTokens(text);
      expect(getTokenText(text, tokens[0])).toEqual([
        "{{",
        PromptySemanticTokenTypes.PunctuationTemplateBegin,
      ]);
      expect(getTokenText(text, tokens[1])).toEqual([
        "variable1",
        PromptySemanticTokenTypes.Variable,
      ]);
      expect(getTokenText(text, tokens[2])).toEqual([
        "}}",
        PromptySemanticTokenTypes.PunctuationTemplateEnd,
      ]);
      expect(getTokenText(text, tokens[3])).toEqual([
        "{{",
        PromptySemanticTokenTypes.PunctuationTemplateBegin,
      ]);
      expect(getTokenText(text, tokens[4])).toEqual([
        "variable2",
        PromptySemanticTokenTypes.Variable,
      ]);
      expect(getTokenText(text, tokens[5])).toEqual([
        "}}",
        PromptySemanticTokenTypes.PunctuationTemplateEnd,
      ]);
    });

    it("should correctly tokenize variables with new lines in the definition", () => {
      const text = "{{ variable\n }}";
      const tokens: Token[] = jinjaTokens(text);
      expect(getTokenText(text, tokens[0])).toEqual([
        "{{",
        PromptySemanticTokenTypes.PunctuationTemplateBegin,
      ]);
      expect(getTokenText(text, tokens[1])).toEqual([
        "variable",
        PromptySemanticTokenTypes.Variable,
      ]);
      expect(getTokenText(text, tokens[2])).toEqual([
        "}}",
        PromptySemanticTokenTypes.PunctuationTemplateEnd,
      ]);
    });

    it("should correctly tokenize partial matches", () => {
      const text = "{{";
      const tokens: Token[] = jinjaTokens(text);
      expect(getTokenText(text, tokens[0])).toEqual([
        "{{",
        PromptySemanticTokenTypes.PunctuationTemplateBegin,
      ]);
    });

    it("should correctly tokenize closed braces with no content", () => {
      const text = "{{}}";
      const tokens: Token[] = jinjaTokens(text);
      expect(tokens.length).toBe(2);
      expect(getTokenText(text, tokens[0])).toEqual([
        "{{",
        PromptySemanticTokenTypes.PunctuationTemplateBegin,
      ]);
      expect(getTokenText(text, tokens[1])).toEqual([
        "}}",
        PromptySemanticTokenTypes.PunctuationTemplateEnd,
      ]);
    });
  });

  describe("statements", () => {
    it("should correctly tokenize a for loop", () => {
      const text = "{% for variable in collection %}";
      const tokens: Token[] = jinjaTokens(text);
      expect(tokens.length).toBe(6);
      expect(getTokenText(text, tokens[0])).toEqual([
        "{%",
        PromptySemanticTokenTypes.PunctuationTemplateBegin,
      ]);
      expect(getTokenText(text, tokens[1])).toEqual(["for", PromptySemanticTokenTypes.Keyword]);
      expect(getTokenText(text, tokens[2])).toEqual([
        "variable",
        PromptySemanticTokenTypes.Variable,
      ]);
      expect(getTokenText(text, tokens[3])).toEqual(["in", PromptySemanticTokenTypes.Keyword]);
      expect(getTokenText(text, tokens[4])).toEqual([
        "collection",
        PromptySemanticTokenTypes.Variable,
      ]);
      expect(getTokenText(text, tokens[5])).toEqual([
        "%}",
        PromptySemanticTokenTypes.PunctuationTemplateEnd,
      ]);
    });

    it("should correctly tokenize an endfor statement", () => {
      const text = "{% endfor %}";
      const tokens: Token[] = jinjaTokens(text);
      expect(getTokenText(text, tokens[0])).toEqual([
        "{%",
        PromptySemanticTokenTypes.PunctuationTemplateBegin,
      ]);
      expect(getTokenText(text, tokens[1])).toEqual(["endfor", PromptySemanticTokenTypes.Keyword]);
      expect(getTokenText(text, tokens[2])).toEqual([
        "%}",
        PromptySemanticTokenTypes.PunctuationTemplateEnd,
      ]);
    });

    it("should correctly tokenize an if statement", () => {
      const text = "{% if variable %}";
      const tokens: Token[] = jinjaTokens(text);
      expect(getTokenText(text, tokens[0])).toEqual([
        "{%",
        PromptySemanticTokenTypes.PunctuationTemplateBegin,
      ]);
      expect(getTokenText(text, tokens[1])).toEqual(["if", PromptySemanticTokenTypes.Keyword]);
      expect(getTokenText(text, tokens[2])).toEqual([
        "variable",
        PromptySemanticTokenTypes.Variable,
      ]);
      expect(getTokenText(text, tokens[3])).toEqual([
        "%}",
        PromptySemanticTokenTypes.PunctuationTemplateEnd,
      ]);
    });

    it("should correctly tokenize an if not statement", () => {
      const text = "{% if not variable %}";
      const tokens: Token[] = jinjaTokens(text);
      expect(getTokenText(text, tokens[0])).toEqual([
        "{%",
        PromptySemanticTokenTypes.PunctuationTemplateBegin,
      ]);
      expect(getTokenText(text, tokens[1])).toEqual(["if", PromptySemanticTokenTypes.Keyword]);
      expect(getTokenText(text, tokens[2])).toEqual(["not", PromptySemanticTokenTypes.Keyword]);
      expect(getTokenText(text, tokens[3])).toEqual([
        "variable",
        PromptySemanticTokenTypes.Variable,
      ]);
      expect(getTokenText(text, tokens[4])).toEqual([
        "%}",
        PromptySemanticTokenTypes.PunctuationTemplateEnd,
      ]);
    });

    it("should correctly tokenize an endif statement", () => {
      const text = "{% endif %}";
      const tokens: Token[] = jinjaTokens(text);
      expect(getTokenText(text, tokens[0])).toEqual([
        "{%",
        PromptySemanticTokenTypes.PunctuationTemplateBegin,
      ]);
      expect(getTokenText(text, tokens[1])).toEqual(["endif", PromptySemanticTokenTypes.Keyword]);
      expect(getTokenText(text, tokens[2])).toEqual([
        "%}",
        PromptySemanticTokenTypes.PunctuationTemplateEnd,
      ]);
    });
  });

  describe("combined", () => {
    it("should correctly tokenize a complex multiline string", () => {
      const text = `
      {% for apple in basket %}
        {{ banana }}
      {% endfor %}
      {% if pear %}
        {{ pineapple }}
      {% endif %}
    `;
      const tokens: Token[] = jinjaTokens(text);

      // Check the 'for' loop
      expect(getTokenText(text, tokens[0])).toEqual([
        "{%",
        PromptySemanticTokenTypes.PunctuationTemplateBegin,
      ]);
      expect(getTokenText(text, tokens[1])).toEqual(["for", PromptySemanticTokenTypes.Keyword]);
      expect(getTokenText(text, tokens[2])).toEqual(["apple", PromptySemanticTokenTypes.Variable]);
      expect(getTokenText(text, tokens[3])).toEqual(["in", PromptySemanticTokenTypes.Keyword]);
      expect(getTokenText(text, tokens[4])).toEqual(["basket", PromptySemanticTokenTypes.Variable]);
      expect(getTokenText(text, tokens[5])).toEqual([
        "%}",
        PromptySemanticTokenTypes.PunctuationTemplateEnd,
      ]);

      // Check the variable inside the 'for' loop
      expect(getTokenText(text, tokens[6])).toEqual([
        "{{",
        PromptySemanticTokenTypes.PunctuationTemplateBegin,
      ]);
      expect(getTokenText(text, tokens[7])).toEqual(["banana", PromptySemanticTokenTypes.Variable]);
      expect(getTokenText(text, tokens[8])).toEqual([
        "}}",
        PromptySemanticTokenTypes.PunctuationTemplateEnd,
      ]);

      // Check the 'endfor'
      expect(getTokenText(text, tokens[9])).toEqual([
        "{%",
        PromptySemanticTokenTypes.PunctuationTemplateBegin,
      ]);
      expect(getTokenText(text, tokens[10])).toEqual(["endfor", PromptySemanticTokenTypes.Keyword]);
      expect(getTokenText(text, tokens[11])).toEqual([
        "%}",
        PromptySemanticTokenTypes.PunctuationTemplateEnd,
      ]);

      // Check the 'if' statement
      expect(getTokenText(text, tokens[12])).toEqual([
        "{%",
        PromptySemanticTokenTypes.PunctuationTemplateBegin,
      ]);
      expect(getTokenText(text, tokens[13])).toEqual(["if", PromptySemanticTokenTypes.Keyword]);
      expect(getTokenText(text, tokens[14])).toEqual(["pear", PromptySemanticTokenTypes.Variable]);
      expect(getTokenText(text, tokens[15])).toEqual([
        "%}",
        PromptySemanticTokenTypes.PunctuationTemplateEnd,
      ]);

      // Check the variable inside the 'if' statement
      expect(getTokenText(text, tokens[16])).toEqual([
        "{{",
        PromptySemanticTokenTypes.PunctuationTemplateBegin,
      ]);
      expect(getTokenText(text, tokens[17])).toEqual([
        "pineapple",
        PromptySemanticTokenTypes.Variable,
      ]);
      expect(getTokenText(text, tokens[18])).toEqual([
        "}}",
        PromptySemanticTokenTypes.PunctuationTemplateEnd,
      ]);

      // Check the 'endif'
      expect(getTokenText(text, tokens[19])).toEqual([
        "{%",
        PromptySemanticTokenTypes.PunctuationTemplateBegin,
      ]);
      expect(getTokenText(text, tokens[20])).toEqual(["endif", PromptySemanticTokenTypes.Keyword]);
      expect(getTokenText(text, tokens[21])).toEqual([
        "%}",
        PromptySemanticTokenTypes.PunctuationTemplateEnd,
      ]);
    });
  });
});
