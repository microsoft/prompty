import * as ay from "@alloy-js/core";
import {
  EmitContext,
  getDoc,
  getDocData,
  getEffectiveModelType,
  getEntityName,
  getPropertyType,
  getTypeName,
  Model,
  ModelProperty,
  Program,
} from "@typespec/compiler";
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
      {emitModel(context.program, model)}
    </ay.Output>,
    context.emitterOutputDir
  );
}

const emitModel = (program: Program, model: Model) => {
  const modelDocs = getDocData(program, model);
  if (!modelDocs) {
    throw new Error(
      `Model ${model.name} does not have documentation. Please add documentation to the model.`
    );
  }
  return (
    <ay.SourceFile path={`${model.name}.md`} filetype="md">
      <>{`# ${model.name}`}</>
      <br />
      <>{modelDocs.value}</>
      <br />
      <br />
      <>{`## Properties`}</>
      <br />
      <>{"| Property | Type | Description |"}</>
      <br />
      <>{`| --- | --- | --- |`}</>
      <br />
      <ay.For each={model.properties}>
        {(key: string, value: ModelProperty) => {
          const type = getPropertyType(value);
          const options = {
            nameOnly: true,
            printable: true,
          };
          const typeName = getTypeName(type, options)
            .replaceAll("|", " or")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;");

          return <>{`| ${key} | (**${type.kind}**) ${typeName}  | ${getDoc(program, value)} |`}</>;
        }}
      </ay.For>
    </ay.SourceFile>
  );
};
