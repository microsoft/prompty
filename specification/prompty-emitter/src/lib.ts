import { createTypeSpecLibrary, JSONSchemaType } from "@typespec/compiler";

export interface EmitTarget {
  "type": string;
  "output-dir"?: string;
}
export interface PromptyEmitterOptions {
  "emit-targets"?: EmitTarget[];
  "root-namespace"?: string;
  "root-object"?: string;
}

const PromptyEmitterOptionsSchema: JSONSchemaType<PromptyEmitterOptions> = {
  type: "object",
  additionalProperties: false,
  properties: {
    "emit-targets": {
      type: "array",
      items: {
        type: "object",
        properties: {
          "type": {
            type: "string"
          },
          "output-dir": {
            type: "string",
            nullable: true
          }
        },
        required: ["type"]
      },
      nullable: true,
      description: "List of target languages to emit code for"
    },
    "root-namespace": {
      type: "string",
      nullable: true,
      description: "Root namespace for the emitted code"
    },
    "root-object": {
      type: "string",
      nullable: true,
      description: "Root object for the emitted code"
    }
  },
  required: [],
};

export const $lib = createTypeSpecLibrary({
  name: "@prompty/emitter",
  diagnostics: {},
  emitter: { options: PromptyEmitterOptionsSchema },
  state: {
    samples: { description: "Sample values for properties" },
    alternates: { description: "Alternate values for properties" },
    abstracts: { description: "Abstract models" }
  }
});

export const { reportDiagnostic, createDiagnostic } = $lib;
export const StateKeys = $lib.stateKeys;
