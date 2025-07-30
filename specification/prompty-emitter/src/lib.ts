import { createTypeSpecLibrary, JSONSchemaType } from "@typespec/compiler";

export interface PromptyEmitterOptions {
  "target-name"?: string;
}

const PromptyEmitterOptionsSchema: JSONSchemaType<PromptyEmitterOptions> = {
  type: "object",
  additionalProperties: false,
  properties: {
    "target-name": {
      type: "string",
      nullable: true,
      default: "test-package",
      description: "Name of the package as it will be in package.json",
    },
  },
  required: [],
};

export const $lib = createTypeSpecLibrary({
  name: "@prompty/emitter",
  emitter: {
    options: PromptyEmitterOptionsSchema,
  },
  diagnostics: {},
  state: {
    unionResolution: { description: "Types resolved by @resolve'd Union types" },
  }
});

export const { reportDiagnostic, createDiagnostic } = $lib;
export const StateKeys = $lib.stateKeys;
