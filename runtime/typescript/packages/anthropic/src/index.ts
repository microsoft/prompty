/**
 * @prompty/anthropic — Anthropic provider for Prompty.
 *
 * Importing this package auto-registers the "anthropic" executor and processor.
 *
 * @module @prompty/anthropic
 */

export { AnthropicExecutor } from "./executor.js";
export { AnthropicProcessor, processResponse, processStream } from "./processor.js";
export { buildChatArgs, messageToWire, toolsToWire, outputsToWire } from "./wire.js";
export { listModels, modelInfoFromWire } from "./models.js";

// Auto-register on import
import { registerExecutor, registerProcessor } from "@prompty/core";
import { AnthropicExecutor } from "./executor.js";
import { AnthropicProcessor } from "./processor.js";

registerExecutor("anthropic", new AnthropicExecutor());
registerProcessor("anthropic", new AnthropicProcessor());
