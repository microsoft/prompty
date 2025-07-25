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
  Type,
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
      {emitModel(context.program, model, 0)}
    </ay.Output>,
    context.emitterOutputDir
  );
}

const emitModel = (program: Program, model: Model, depth: number) => {
  const modelDocs = getDoc(program, model);

  const modelStack: Model[] = [];
  const hasProperties = model.properties && model.properties.size > 0;
  return (
    <ay.SourceFile path={`${model.name}.md`} filetype="md">
      <>{`# ${model.name}`}</>
      <br />
      <>{modelDocs}</>
      <br />
      <br />
      {hasProperties ? (
        <>
          <>{`## Properties`}</>
          <br />
          <>{"| Property | Type | Description |"}</>
          <br />
          <>{`| --- | --- | --- |`}</>
          <br />
          <ay.For each={model.properties}>
            {(key: string, value: ModelProperty) => {
              const type = getPropertyType(value);
              if (type.kind === "Model" && !modelStack.includes(type)) {
                modelStack.push(type);
              }

              return (
                <>{`| ${key} | ${emitPropertyName(value, type)} | ${getDoc(program, value)} |`}</>
              );
            }}
          </ay.For>
          <ay.For each={modelStack}>
            {(m: Model) => {
              return (
                <>
                  <br />
                  {emitModel(program, m, depth + 1)}
                </>
              );
            }}
          </ay.For>
        </>
      ) : (
        <>{`No properties found for model **${model.name}**.`}</>
      )}
    </ay.SourceFile>
  );
};

const emitPropertyName = (property: ModelProperty, type: Type) => {
  const options = {
    nameOnly: true,
    printable: true,
  };
  const typeName = getTypeName(type, options)
    .replaceAll("|", " or")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  if (type.kind === "Model") {
    return `[${typeName}](#${typeName.toLocaleLowerCase().replaceAll(" ", "-")})`;
  } else if (type.kind === "Union") {
    return typeName;
  } else {
    return typeName;
  }
};
