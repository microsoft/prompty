/**
 * Prompty chat parser — splits rendered text into abstract messages.
 *
 * Recognizes role markers (`system:`, `user:`, `assistant:`, `developer:`)
 * and inline markdown images. Supports nonce-based sanitization when
 * `Format.strict` is enabled.
 *
 * @module
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { randomBytes } from "node:crypto";
import type { Prompty } from "../model/prompty.js";
import {
  type ContentPart,
  type ImagePart,
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

// Markdown image regex — `![alt](url)`
const IMAGE_RE = /(?<alt>!\[[^\]]*\])\((?<filename>[^\s)]+)(?:\s+[^)]*)?\)/g;

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

    for (const line of text.split("\n")) {
      const stripped = line.trim();
      const m = BOUNDARY_RE.exec(stripped);

      if (m) {
        if (contentBuffer.length > 0) {
          messages.push(this.buildMessage(role, contentBuffer, attrs, nonce, basePath));
          contentBuffer = [];
        }

        role = m[1].trim().toLowerCase();
        const rawAttrs = m[2]; // e.g. [name="Alice",nonce="abc"]
        attrs = rawAttrs ? this.parseAttrs(rawAttrs) : {};
        continue;
      }

      contentBuffer.push(line);
    }

    // Flush remaining content
    if (contentBuffer.length > 0) {
      messages.push(this.buildMessage(role, contentBuffer, attrs, nonce, basePath));
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

    // Parse content for inline images
    const parts = this.parseContent(content, basePath);

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

  private parseContent(content: string, basePath: string | undefined): ContentPart[] {
    const re = new RegExp(IMAGE_RE.source, IMAGE_RE.flags);
    const matches: RegExpExecArray[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      matches.push(m);
    }

    if (matches.length === 0) {
      return [{ kind: "text", value: content } as TextPart];
    }

    const parts: ContentPart[] = [];
    let lastEnd = 0;

    for (const match of matches) {
      const before = content.slice(lastEnd, match.index).trim();
      if (before) {
        parts.push({ kind: "text", value: before } as TextPart);
      }

      const filename = match.groups!.filename.split(" ")[0].trim();
      const source = this.resolveImage(filename, basePath);
      parts.push({ kind: "image", source } as ImagePart);

      lastEnd = match.index + match[0].length;
    }

    const after = content.slice(lastEnd).trim();
    if (after) {
      parts.push({ kind: "text", value: after } as TextPart);
    }

    return parts;
  }

  private resolveImage(imageRef: string, basePath: string | undefined): string {
    if (imageRef.startsWith("http://") || imageRef.startsWith("https://") || imageRef.startsWith("data:")) {
      return imageRef;
    }

    // Local file — resolve and base64 encode
    const imagePath = basePath ? resolve(basePath, imageRef) : imageRef;

    if (!existsSync(imagePath)) {
      return imageRef;
    }

    const data = readFileSync(imagePath);
    const b64 = data.toString("base64");

    const ext = extname(imagePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
    };
    const mime = mimeMap[ext] ?? "application/octet-stream";
    return `data:${mime};base64,${b64}`;
  }
}
