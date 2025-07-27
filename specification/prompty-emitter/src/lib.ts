import { createTypeSpecLibrary } from "@typespec/compiler";

export const $lib = createTypeSpecLibrary({
  name: "@prompty/emitter",
  diagnostics: {},
  state: {
    unionResolution: { description: "Types resolved by @resolve'd Union types" },
  }
});

export const { reportDiagnostic, createDiagnostic } = $lib;
export const StateKeys = $lib.stateKeys;
