/**
 * Structured output — LLM returns JSON matching the output schema.
 *
 * When a .prompty file defines `outputs:`, the processor automatically
 * parses the LLM response as JSON.
 *
 * @example
 * ```bash
 * OPENAI_API_KEY=sk-... npx tsx examples/structured-output.ts
 * ```
 */
import "@prompty/openai";
import { invoke } from "@prompty/core";
import { resolve } from "node:path";

const promptyFile = resolve(import.meta.dirname, "../../prompts/structured-output.prompty");

interface WeatherResult {
  city: string;
  temperature: number;
  conditions: string;
}

export async function structuredOutput(city?: string): Promise<WeatherResult> {
  const result = await invoke(promptyFile, {
    city: city ?? "Seattle",
  });
  return result as WeatherResult;
}

// Run directly
const weather = await structuredOutput();
console.log("Structured response:", JSON.stringify(weather, null, 2));
console.log(`City: ${weather.city}`);
console.log(`Temperature: ${weather.temperature}°F`);
console.log(`Conditions: ${weather.conditions}`);
