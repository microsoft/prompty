/**
 * @prompty/openai — OpenAI provider for Prompty.
 *
 * Importing this package auto-registers the "openai" executor and processor.
 *
 * @module @prompty/openai
 */

export { OpenAIExecutor } from "./executor.js";
export { OpenAIProcessor, processResponse } from "./processor.js";
export { messageToWire, buildChatArgs, buildEmbeddingArgs, buildImageArgs, buildResponsesArgs } from "./wire.js";

// Auto-register on import
import { registerExecutor, registerProcessor } from "@prompty/core";
import { OpenAIExecutor } from "./executor.js";
import { OpenAIProcessor } from "./processor.js";

registerExecutor("openai", new OpenAIExecutor());
registerProcessor("openai", new OpenAIProcessor());
