/**
 * Generate text embeddings using an embedding model.
 *
 * @example
 * ```bash
 * OPENAI_API_KEY=sk-... npx tsx examples/embeddings.ts
 * ```
 */
import "@prompty/openai";
import { invoke } from "@prompty/core";
import { resolve } from "node:path";

const promptyFile = resolve(import.meta.dirname, "../../prompts/embedding.prompty");

export async function generateEmbedding(text?: string): Promise<number[]> {
  const result = await invoke(promptyFile, {
    text: text ?? "Prompty is a prompt asset format",
  });
  return result as number[];
}

// Run directly
const embedding = await generateEmbedding();
console.log(`Embedding dimensions: ${embedding.length}`);
console.log(`First 5 values: [${embedding.slice(0, 5).join(", ")}]`);
