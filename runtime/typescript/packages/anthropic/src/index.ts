/**
 * @prompty/anthropic — Anthropic provider for Prompty.
 *
 * Importing this package auto-registers the "anthropic" executor and processor.
 *
 * NOTE: This is currently a scaffolding package. The executor and processor
 * throw "not yet implemented" errors. A future version will add full
 * Anthropic API support.
 *
 * @module @prompty/anthropic
 */

export { AnthropicExecutor } from "./executor.js";
export { AnthropicProcessor } from "./processor.js";

// Auto-register on import
import { registerExecutor, registerProcessor } from "@prompty/core";
import { AnthropicExecutor } from "./executor.js";
import { AnthropicProcessor } from "./processor.js";

registerExecutor("anthropic", new AnthropicExecutor());
registerProcessor("anthropic", new AnthropicProcessor());
