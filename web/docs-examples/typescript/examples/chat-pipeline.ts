/**
 * Step-by-step pipeline: load → prepare → run.
 *
 * Shows each stage of the Prompty pipeline individually,
 * so you can inspect intermediate results.
 *
 * @example
 * ```bash
 * OPENAI_API_KEY=sk-... npx tsx examples/chat-pipeline.ts
 * ```
 */
import "@prompty/openai";
import { load, prepare, run } from "@prompty/core";
import { resolve } from "node:path";

const promptyFile = resolve(import.meta.dirname, "../../prompts/chat-basic.prompty");

export async function chatPipeline(question?: string): Promise<string> {
  // Step 1: Load the .prompty file into a typed Prompty object
  const agent = load(promptyFile);
  console.log("Loaded agent:", agent.name);
  console.log("Model:", agent.model.id);

  // Step 2: Render the template + parse into messages
  const messages = await prepare(agent, {
    question: question ?? "What is Prompty?",
  });
  console.log("Prepared messages:");
  for (const msg of messages) {
    console.log(`  [${msg.role}] ${msg.text.slice(0, 80)}...`);
  }

  // Step 3: Send messages to the LLM and process the response
  const result = await run(agent, messages);
  return result as string;
}

// Run directly
const response = await chatPipeline();
console.log("\nFinal response:", response);
