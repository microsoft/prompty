/**
 * @prompty/foundry — Microsoft Foundry and Azure OpenAI provider for Prompty.
 *
 * Importing this package auto-registers:
 * - "foundry" executor and processor (primary)
 * - "azure" executor and processor (deprecated alias for backward compatibility)
 *
 * @module @prompty/foundry
 */

export { FoundryExecutor } from "./executor.js";
export { FoundryProcessor } from "./processor.js";
export { AzureExecutor } from "./azure-executor.js";
export { AzureProcessor } from "./azure-processor.js";

// Auto-register on import
import { registerExecutor, registerProcessor } from "@prompty/core";
import { FoundryExecutor } from "./executor.js";
import { FoundryProcessor } from "./processor.js";
import { AzureExecutor } from "./azure-executor.js";
import { AzureProcessor } from "./azure-processor.js";

// Primary registration
registerExecutor("foundry", new FoundryExecutor());
registerProcessor("foundry", new FoundryProcessor());

// Deprecated backward-compat alias
registerExecutor("azure", new AzureExecutor());
registerProcessor("azure", new AzureProcessor());
