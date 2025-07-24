import { resolvePath } from "@typespec/compiler";
import { createTestLibrary, TypeSpecTestLibrary } from "@typespec/compiler/testing";
import { fileURLToPath } from "url";

export const PromptyDocTestLibrary: TypeSpecTestLibrary = createTestLibrary({
  name: "prompty-doc",
  packageRoot: resolvePath(fileURLToPath(import.meta.url), "../../../../"),
});
