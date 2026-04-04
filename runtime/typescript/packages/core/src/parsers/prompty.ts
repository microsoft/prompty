/**
 * Prompty chat parser — splits rendered text into abstract messages.
 *
 * Recognizes role markers (`system:`, `user:`, `assistant:`, `developer:`).
 * Supports nonce-based sanitization when `FormatConfig.strict` is enabled.
 *
 * Images should be passed via `kind: image` input properties rather than
 * inline markdown syntax. Inline `![alt](url)` is preserved as literal text.
 *
 * @module
 */

import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { Prompty } from "../model/prompty.js";
import {
  type TextPart,
  Message,
  ROLES,
} from "../core/types.js";
import type { Parser } from "../core/interfaces.js";

// Role boundary regex — matches lines like `system:` or `user[name="Alice"]:`
const ROLE_NAMES = [...ROLES].filter((r) => r !== "tool").sort().join("|");
const BOUNDARY_RE = new RegExp(
  `^\\s*#?\\s*(${ROLE_NAMES})(\\[((\\w+\\s*=\\s*"?[^"]*"?\\s*,?\\s*)+)\\])?\\s*:\\s*$`,
  "i",
);

// Attribute key=value regex
const ATTR_RE = /(\w+)\s*=\s*"?([^",]*)"?/g;

export class PromptyChatParser implements Parser {
  // ---- preRender (optional sanitization) ----

  preRender(template: string): [string, Record<string, unknown>] {
    const nonce = randomBytes(8).toString("hex");
    const sanitized = template
      .split("\n")
      .map((line) => {
        const m = BOUNDARY_RE.exec(line.trim());
        if (m) {
          const role = m[1].trim().toLowerCase();
          return `${role}[nonce="${nonce}"]:\n`;
        }
        return line;
      })
      .join("\n");

    return [sanitized, { nonce }];
  }

  // ---- parse ----

  async parse(
    agent: Prompty,
    rendered: string,
    context?: Record<string, unknown>,
  ): Promise<Message[]> {
    const nonce = context?.nonce as string | undefined;
    const basePath = this.resolveBasePath(agent);
    return this.parseMessages(rendered, nonce, basePath);
  }

  // ---- internal parsing ----

  private resolveBasePath(agent: Prompty): string | undefined {
    const meta = agent.metadata as Record<string, unknown> | undefined;
    if (meta && typeof meta.source_path === "string") {
      return resolve(meta.source_path, "..");
    }
    return undefined;
  }

  private parseMessages(
    text: string,
    nonce: string | undefined,
    basePath: string | undefined,
  ): Message[] {
    const messages: Message[] = [];
    let contentBuffer: string[] = [];
    let role = "system"; // default role if none specified
    let attrs: Record<string, unknown> = {};
    let hasBoundary = false; // tracks if current segment started with a role marker

    for (const line of text.split("\n")) {
      const stripped = line.trim();
      const m = BOUNDARY_RE.exec(stripped);

      if (m) {
        if (contentBuffer.length > 0) {
          messages.push(this.buildMessage(role, contentBuffer, attrs, hasBoundary ? nonce : undefined, basePath));
          contentBuffer = [];
        }

        role = m[1].trim().toLowerCase();
        const rawAttrs = m[2]; // e.g. [name="Alice",nonce="abc"]
        attrs = rawAttrs ? this.parseAttrs(rawAttrs) : {};
        hasBoundary = true;
        continue;
      }

      contentBuffer.push(line);
    }

    // Flush remaining content
    if (contentBuffer.length > 0) {
      messages.push(this.buildMessage(role, contentBuffer, attrs, hasBoundary ? nonce : undefined, basePath));
    }

    return messages;
  }

  private buildMessage(
    role: string,
    lines: string[],
    attrs: Record<string, unknown>,
    nonce: string | undefined,
    basePath: string | undefined,
  ): Message {
    // Strip leading/trailing blank lines from content
    let content = lines.join("\n").replace(/^\n+|\n+$/g, "");

    // Validate nonce in strict mode
    if (nonce !== undefined) {
      const msgNonce = attrs.nonce as string | undefined;
      delete attrs.nonce;
      if (msgNonce !== nonce) {
        throw new Error(
          "Nonce mismatch — possible prompt injection detected " +
          "(strict mode is enabled). A template variable may be " +
          "injecting role markers.",
        );
      }
    }

    const parts: TextPart[] = [{ kind: "text", value: content }];

    // Remaining attrs become metadata
    const metadata: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(attrs)) {
      if (k !== "nonce") metadata[k] = v;
    }

    return new Message(role as Message["role"], parts, metadata);
  }

  private parseAttrs(raw: string): Record<string, unknown> {
    const inner = raw.replace(/^\[|\]$/g, "");
    const result: Record<string, unknown> = {};

    let m: RegExpExecArray | null;
    const re = new RegExp(ATTR_RE.source, ATTR_RE.flags);
    while ((m = re.exec(inner)) !== null) {
      const key = m[1];
      const val = m[2].trim();

      // Type coercion
      if (val.toLowerCase() === "true") {
        result[key] = true;
      } else if (val.toLowerCase() === "false") {
        result[key] = false;
      } else if (/^\d+$/.test(val)) {
        result[key] = parseInt(val, 10);
      } else if (/^\d+\.\d+$/.test(val)) {
        result[key] = parseFloat(val);
      } else {
        result[key] = val;
      }
    }

    return result;
  }

}
