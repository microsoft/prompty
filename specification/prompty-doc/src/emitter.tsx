import * as ay from "@alloy-js/core";
import {
  EmitContext,
  getEntityName,
  getPropertyType,
  ModelProperty,
} from "@typespec/compiler";
import { writeOutput } from "@typespec/emitter-framework";
import { ModelDescription } from "./components/ModelDescription.js";
import { UnionDescription } from "./components/UnionDescription.jsx";

export async function $onEmit(context: EmitContext) {
  const m = context.program.resolveTypeReference("Prompty.Core.Prompty");
  if (!m[0] || m[0].kind !== "Model") {
    throw new Error(
      "Prompty.Core.Prompty model not found or is not a model type."
    );
  }
  const model = m[0];
  // enumerate model properties and write "Model" kinds to array
  const modelProperties: ModelProperty[] = [];
  for (const [_, value] of model.properties) {
    const type = getPropertyType(value);
    if (type.kind === "Model" || type.kind === "Union") {
      modelProperties.push(value);
    }
  }

  await writeOutput(
    context.program,
    <ay.Output>
      <ay.SourceDirectory path="src" />
      <ay.SourceFile path={`${model.name}.md`} filetype="md">
        <ModelDescription program={context.program} model={model} />
      </ay.SourceFile>
      <ay.For each={modelProperties}>
        {(prop: ModelProperty) => {
          const type = getPropertyType(prop);
          const entityName = getEntityName(prop, {
            nameOnly: true,
            printable: true,
          });
          return (
            <ay.SourceFile path={`${entityName}.md`} filetype="md">
              {type.kind === "Model" && (
                <ModelDescription
                  program={context.program}
                  model={type}
                  recursive={true}
                />
              )}
              {type.kind === "Union" && (
                <UnionDescription
                  program={context.program}
                  union={type}
                  recursive={true}
                />
              )}
            </ay.SourceFile>
          );
        }}
      </ay.For>
    </ay.Output>,
    context.emitterOutputDir
  );
}
