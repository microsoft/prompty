/**
 * Agent with tool calling — define tools, load agent prompty, invoke.
 *
 * Uses `tool()` to wrap functions with metadata and `bindTools()` to
 * validate handlers against the agent's declared tools.
 *
 * @example
 * ```bash
 * OPENAI_API_KEY=sk-... npx tsx examples/agent-tool-calling.ts
 * ```
 */
import "@prompty/openai";
import { tool, bindTools, turn, load } from "@prompty/core";
import { resolve } from "node:path";

const promptyFile = resolve(import.meta.dirname, "../../prompts/chat-agent.prompty");

// Define a tool with typed parameters
const getWeather = tool(
  (args: Record<string, unknown>) => {
    const city = args.city as string;
    return JSON.stringify({ city, temperature: 72, conditions: "sunny" });
  },
  {
    name: "get_weather",
    description: "Get the current weather for a city",
    parameters: [
      { name: "city", kind: "string", description: "City name", required: true },
    ],
  },
);

export async function agentToolCalling(question?: string): Promise<string> {
  const agent = load(promptyFile);

  // Validate tool handlers against agent's declared tools
  const tools = bindTools(agent, [getWeather]);

  // turn runs the LLM loop: call → tool dispatch → call → ...
  const result = await turn(agent, {
    question: question ?? "What's the weather in Seattle?",
  }, {
    tools,
    maxIterations: 5,
  });

  return result as string;
}

// Run directly
const response = await agentToolCalling();
console.log(response);
