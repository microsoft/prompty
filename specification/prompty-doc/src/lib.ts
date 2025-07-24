import {
  createTypeSpecLibrary,
} from "@typespec/compiler";

export const $lib = createTypeSpecLibrary({
  name: "prompty-doc",
  diagnostics: {},
});

export const { reportDiagnostic, createDiagnostic } = $lib;
