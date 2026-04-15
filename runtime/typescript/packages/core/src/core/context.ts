/**
 * §13.3 Context Window Management — trimming and summarization.
 * @module
 */

import { Message, TextPart } from "./types.js";

/**
 * Estimate the character cost of a message list.
 * Per spec §13.3: role + 4 overhead per message, text parts by length,
 * non-text parts at 200-char estimate.
 */
export function estimateChars(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    total += msg.role.length + 4;
    for (const part of msg.parts) {
      if (part.kind === "text") {
        total += (part as TextPart).value.length;
      } else {
        total += 200;
      }
    }
    const toolCalls = msg.metadata?.tool_calls;
    if (toolCalls) {
      total += JSON.stringify(toolCalls).length;
    }
  }
  return total;
}

function truncate(text: string, maxLen = 200): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen) + "…";
}

/**
 * Build a compact string summary from dropped messages.
 */
export function summarizeDropped(messages: Message[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const msgText = msg.text.trim();
    if (msg.role === "user" && msgText) {
      lines.push(`User asked: ${truncate(msgText)}`);
    } else if (msg.role === "assistant") {
      if (msgText) lines.push(`Assistant: ${truncate(msgText)}`);
      const toolCalls = msg.metadata?.tool_calls;
      if (Array.isArray(toolCalls)) {
        const names = toolCalls.map(
          (tc: Record<string, unknown>) =>
            (tc.name as string) ?? ((tc.function as Record<string, string>)?.name ?? "?"),
        );
        lines.push(`  Called tools: ${names.join(", ")}`);
      }
    }
  }
  if (lines.length === 0) return "";

  let result = "[Context summary: ";
  for (const line of lines) {
    if (result.length + line.length > 4000) {
      result += "\n... (older messages omitted)";
      break;
    }
    result += line + "\n";
  }
  return result.trimEnd() + "]";
}

/**
 * Format dropped messages as a human-readable text block.
 * Each message is rendered as `[role]: content`, with tool calls shown as
 * `Called: name(args)`.
 */
export function formatDroppedMessages(messages: Message[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const msgText = msg.text.trim();
    if (msgText) {
      lines.push(`[${msg.role}]: ${msgText}`);
    }
    const toolCalls = msg.metadata?.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        const tcObj = tc as Record<string, unknown>;
        const name = (tcObj.name as string) ?? ((tcObj.function as Record<string, string>)?.name ?? "?");
        const args = (tcObj.arguments as string) ?? ((tcObj.function as Record<string, string>)?.arguments ?? "");
        lines.push(`Called: ${name}(${args})`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * Trim messages in-place to fit within a character budget.
 * Returns [droppedCount, droppedMessages].
 */
export function trimToContextWindow(
  messages: Message[],
  budgetChars: number,
): [number, Message[]] {
  if (estimateChars(messages) <= budgetChars) {
    return [0, []];
  }

  // Partition: leading system messages vs rest
  let systemEnd = 0;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== "system") {
      systemEnd = i;
      break;
    }
    if (i === messages.length - 1) systemEnd = messages.length;
  }

  const systemMsgs = messages.slice(0, systemEnd);
  const rest = messages.slice(systemEnd);
  const summaryBudget = Math.min(5000, Math.floor(budgetChars * 0.05));
  const dropped: Message[] = [];

  while (estimateChars([...systemMsgs, ...rest]) > budgetChars - summaryBudget && rest.length > 2) {
    dropped.push(rest.shift()!);
  }

  const droppedCount = dropped.length;

  // Rebuild messages array in-place
  messages.length = 0;
  messages.push(...systemMsgs);

  if (droppedCount > 0) {
    const summaryText = summarizeDropped(dropped);
    if (summaryText) {
      messages.push(new Message({ role: "user", parts: [new TextPart({ value: summaryText })] }));
    }
  }

  messages.push(...rest);
  return [droppedCount, dropped];
}
