/**
 * Basic chat completion — load a .prompty file and invoke it.
 *
 * @example
 * ```bash
 * OPENAI_API_KEY=sk-... npx tsx examples/chat-basic.ts
 * ```
 */
import "@prompty/openai"; // auto-registers openai executor + processor
import { invoke } from "@prompty/core";
import { resolve } from "node:path";

const promptyFile = resolve(import.meta.dirname, "../../prompts/chat-basic.prompty");

export async function chatBasic(question?: string): Promise<string> {
  const result = await invoke(promptyFile, {
    question: question ?? "What is Prompty?",
  });
  return result as string;
}

// Run directly
const response = await chatBasic();
console.log(response);
