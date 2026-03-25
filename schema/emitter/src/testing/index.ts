import { resolvePath } from "@typespec/compiler";
import { createTestLibrary, TypeSpecTestLibrary } from "@typespec/compiler/testing";
import { fileURLToPath } from "url";

export const AgentSchemaEmitTestLibrary: TypeSpecTestLibrary = createTestLibrary({
  name: "agentschema-emit",
  packageRoot: resolvePath(fileURLToPath(import.meta.url), "../../../../"),
});
