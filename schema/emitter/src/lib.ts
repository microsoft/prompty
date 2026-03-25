import { createTypeSpecLibrary, JSONSchemaType } from "@typespec/compiler";

export interface EmitTarget {
  "type": string;
  "output-dir"?: string;
  "test-dir"?: string;
  "alias"?: { [key: string]: any };
  "format"?: boolean;
  "namespace"?: string;
}
export interface AgentSchemaEmitterOptions {
  "root-object": string;
  "emit-targets"?: EmitTarget[];
  "root-namespace"?: string;
  "root-alias"?: string;
  "omit-models"?: string[];
  "schema-output-dir"?: string;
}

const AgentSchemaEmitterOptionsSchema: JSONSchemaType<AgentSchemaEmitterOptions> = {
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
          },
          "test-dir": {
            type: "string",
            nullable: true
          },
          "alias": {
            type: "object",
            additionalProperties: true,
            nullable: true
          },
          "format": {
            type: "boolean",
            nullable: true,
            default: true,
            description: "Run formatters on emitted files"
          },
          "namespace": {
            type: "string",
            nullable: true,
            description: "Override the namespace for the emitted code"
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
    },
    "omit-models": {
      type: "array",
      items: { type: "string" },
      nullable: true,
      description: "List of model names to omit from generation"
    },
    "schema-output-dir": {
      type: "string",
      nullable: true,
      description: "Directory containing JSON schema files. If set, omitted models will be deleted from this directory after generation."
    }
  },
  required: ["root-object"],
};

export const $lib = createTypeSpecLibrary({
  name: "agentschema-emitter",
  diagnostics: {},
  emitter: { options: AgentSchemaEmitterOptionsSchema },
  state: {
    samples: { description: "Sample values for properties" },
    shorthands: { description: "Shorthand models creation" },
    abstracts: { description: "Abstract models" }
  }
});

export const { reportDiagnostic, createDiagnostic } = $lib;
export const StateKeys = $lib.stateKeys;
