import { TemplateSyntaxError } from "./errors.js";

export type TokenType = "text" | "expr" | "stmt" | "comment";

export interface Token {
  type: TokenType;
  value: string;
  trimLeft: boolean;
  trimRight: boolean;
}

const OPENERS: Record<string, { type: TokenType; close: string }> = {
  "{{": { type: "expr", close: "}}" },
  "{%": { type: "stmt", close: "%}" },
  "{#": { type: "comment", close: "#}" },
};

export function tokenize(template: string): Token[] {
  const raw: Token[] = [];
  let i = 0;
  let textStart = 0;

  while (i < template.length) {
    const two = template.slice(i, i + 2);
    const opener = OPENERS[two];
    if (opener) {
      if (i > textStart) {
        raw.push({
          type: "text",
          value: template.slice(textStart, i),
          trimLeft: false,
          trimRight: false,
        });
      }

      const closeIdx = template.indexOf(opener.close, i + 2);
      if (closeIdx < 0) {
        throw new TemplateSyntaxError(`Unclosed '${two}' tag at offset ${i}`);
      }

      let inner = template.slice(i + 2, closeIdx);
      const trimLeft = inner.startsWith("-");
      const trimRight = inner.endsWith("-");
      if (trimLeft) inner = inner.slice(1);
      if (trimRight) inner = inner.slice(0, -1);

      raw.push({
        type: opener.type,
        value: opener.type === "comment" ? "" : inner.trim(),
        trimLeft,
        trimRight,
      });

      i = closeIdx + opener.close.length;
      textStart = i;
      continue;
    }
    i += 1;
  }

  if (textStart < template.length) {
    raw.push({
      type: "text",
      value: template.slice(textStart),
      trimLeft: false,
      trimRight: false,
    });
  }

  applyTrims(raw);
  return raw.filter((token) => token.type !== "comment");
}

function applyTrims(tokens: Token[]): void {
  for (let idx = 0; idx < tokens.length; idx += 1) {
    const token = tokens[idx];
    if (token.type === "text") continue;
    const prev = tokens[idx - 1];
    if (token.trimLeft && prev?.type === "text") {
      prev.value = prev.value.trimEnd();
    }
    const next = tokens[idx + 1];
    if (token.trimRight && next?.type === "text") {
      next.value = next.value.trimStart();
    }
  }
}
