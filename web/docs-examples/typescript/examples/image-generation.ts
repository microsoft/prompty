/**
 * Image generation with DALL-E.
 *
 * @example
 * ```bash
 * OPENAI_API_KEY=sk-... npx tsx examples/image-generation.ts
 * ```
 */
import "@prompty/openai";
import { invoke } from "@prompty/core";
import { resolve } from "node:path";

const promptyFile = resolve(import.meta.dirname, "../../prompts/image-gen.prompty");

export async function generateImage(prompt?: string): Promise<string> {
  const result = await invoke(promptyFile, {
    prompt: prompt ?? "A serene mountain landscape at sunset",
  });
  return result as string;
}

// Run directly
const imageUrl = await generateImage();
console.log("Generated image URL:", imageUrl);
