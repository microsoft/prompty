import * as ay from "@alloy-js/core";
import { EmitContext, Model, ModelProperty } from "@typespec/compiler";
import { writeOutput } from "@typespec/emitter-framework";

export async function $onEmit(context: EmitContext) {
  const m = context.program.resolveTypeReference("Prompty.Core.Prompty");
  if (!m[0] || m[0].kind !== "Model") {
    throw new Error(
      "Prompty.Core.Prompty model not found or is not a model type."
    );
  }
  const model = m[0];
  await writeOutput(
    context.program,
    <ay.Output>
      <ay.SourceDirectory path="src" />
      {emitModel(model)}
    </ay.Output>,
    context.emitterOutputDir
  );
}

const emitModel = (model: Model) => {
  return (
    <ay.SourceFile path={`${model.name}.md`} filetype="md">
      <>{`# ${model.name}`}</>
      <br/>
      <ay.For each={model.properties}>
        {(key: string, value: ModelProperty) => (
          <ay.Prose>{`${key}: ${value.node?.docs}`}</ay.Prose>
        )}
      </ay.For>
    </ay.SourceFile>
  );
}
