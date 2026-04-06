import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/core",
  "packages/openai",
  "packages/foundry",
  "packages/anthropic",
]);
