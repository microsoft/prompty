/**
 * @prompty/anthropic — Anthropic provider for Prompty.
 *
 * Importing this package auto-registers the "anthropic" executor and processor.
 *
 * @module @prompty/anthropic
 */

export { AnthropicExecutor } from "./executor.js";
export { AnthropicProcessor, processResponse } from "./processor.js";
export { buildChatArgs, messageToWire, toolsToWire, outputSchemaToWire } from "./wire.js";

// Auto-register on import
import { registerExecutor, registerProcessor } from "@prompty/core";
import { AnthropicExecutor } from "./executor.js";
import { AnthropicProcessor } from "./processor.js";

registerExecutor("anthropic", new AnthropicExecutor());
registerProcessor("anthropic", new AnthropicProcessor());
