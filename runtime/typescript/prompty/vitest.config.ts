import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // agentschema exports field points to nonexistent .mjs — use the .js file directly
      agentschema: new URL("node_modules/agentschema/dist/index.js", import.meta.url).pathname.slice(1),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
    },
  },
});
