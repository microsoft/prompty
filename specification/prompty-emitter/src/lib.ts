import { createTypeSpecLibrary, JSONSchemaType } from "@typespec/compiler";

export interface PromptyEmitterOptions {
  "target-name"?: string;
}

const PromptyEmitterOptionsSchema: JSONSchemaType<PromptyEmitterOptions> = {
  type: "object",
  additionalProperties: true,
  properties: {
    "target-name": {
      type: "string",
      default: "test-package",
      nullable: true,
      description: "Name of the package as it will be in package.json",
    },
  },
  required: [],
};

export const $lib = createTypeSpecLibrary({
  name: "@prompty/emitter",
  diagnostics: {},
  emitter: { options: PromptyEmitterOptionsSchema },
  state: {
    unionResolution: { description: "Types resolved by @resolve'd Union types" },
  }
});

export const { reportDiagnostic, createDiagnostic } = $lib;
export const StateKeys = $lib.stateKeys;
