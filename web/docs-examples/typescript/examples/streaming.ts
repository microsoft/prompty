/**
 * Streaming chat completion — consume response chunks as they arrive.
 *
 * The streaming-chat.prompty file sets `stream: true` in model options.
 * The executor wraps the response in a PromptyStream, and the
 * processor yields content strings from each chunk.
 *
 * @example
 * ```bash
 * OPENAI_API_KEY=sk-... npx tsx examples/streaming.ts
 * ```
 */
import "@prompty/openai";
import { invoke } from "@prompty/core";
import { resolve } from "node:path";

const promptyFile = resolve(import.meta.dirname, "../../prompts/streaming-chat.prompty");

export async function streamingChat(question?: string): Promise<string> {
  // invoke() returns a PromptyStream when the prompty has stream: true
  const stream = await invoke(promptyFile, {
    question: question ?? "Tell me a short story",
  });

  // If the result is an async iterable, consume chunks
  if (stream && typeof stream === "object" && Symbol.asyncIterator in stream) {
    const chunks: string[] = [];
    for await (const chunk of stream as AsyncIterable<string>) {
      process.stdout.write(String(chunk));
      chunks.push(String(chunk));
    }
    console.log(); // newline after streaming
    return chunks.join("");
  }

  // Non-streaming fallback
  return stream as string;
}

// Run directly
const response = await streamingChat();
console.log("\nComplete response length:", response.length);
