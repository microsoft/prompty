import { createTypeSpecLibrary, JSONSchemaType } from "@typespec/compiler";

export interface EmitTarget {
  "type": string;
  "output-dir"?: string;
}
export interface PromptyEmitterOptions {
  "root-object": string;
  "emit-targets"?: EmitTarget[];
  "root-namespace"?: string;
  "root-alias"?: string;
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
      nullable: false,
      description: "Root object for the emitted artifacts"
    },
    "root-alias": {
      type: "string",
      nullable: true,
      description: "Alias for the root object"
    }
  },
  required: ["root-object"],
};

export const $lib = createTypeSpecLibrary({
  name: "@prompty/emitter",
  diagnostics: {},
  emitter: { options: PromptyEmitterOptionsSchema },
  state: {
    samples: { description: "Sample values for properties" },
    shorthands: { description: "Shorthand models creation" },
    abstracts: { description: "Abstract models" }
  }
});

export const { reportDiagnostic, createDiagnostic } = $lib;
export const StateKeys = $lib.stateKeys;
