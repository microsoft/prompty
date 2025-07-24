import { Output, SourceDirectory, SourceFile } from "@alloy-js/core";
import { EmitContext, Model, Union, UnionVariant } from "@typespec/compiler";
import { writeOutput } from "@typespec/emitter-framework";

export async function $onEmit(context: EmitContext) {
  //const outputDir = context.emitterOutputDir;
  /*
  const model = context.program.resolveTypeReference("Prompty.Core.Prompty");
  // check if model is returned as "Type"
  if (model[0] && model[0].kind === "Model") {
    console.log(`Emitting model: ${model[0].name}`);
    await emitModel(model[0], 0);
  } else {
    console.error("Prompty model not found or is not a Model type.");
  }
    */
  await writeOutput(
    context.program,
    <Output>
      <SourceDirectory path="src" />
      <SourceFile path="README.md" filetype="md">
        Hello world!
      </SourceFile>
    </Output>,
    context.emitterOutputDir
  );
}

/*
const emitModel = async (model: Model, level: number = 0) => {
  console.log(
    `${"  ".repeat(level)}Emitting ${model.name}${model.templateMapper ? ": " + JSON.stringify(model.templateMapper.args) : ""}`
  );
  if (model.kind === "Model") {
    for (const prop of model.properties.values()) {
      // recursively emit models referenced by the parent model
      console.log(
        `${"  ".repeat(level + 1)}property: ${prop.name} - ${JSON.stringify(prop.type.kind)}`
      );
      if (prop.type.kind === "Model") {
        await emitModel(prop.type, level + 1);
      } else if (prop.type.kind === "Union") {
        await emitUnion(prop.type, level + 1);
      }
    }
  }
};

const emitUnion = async (union: Union, level: number = 0) => {
  console.log(`${"  ".repeat(level)}Union: ${union.name}`);
  //console.log(`${"  ".repeat(level)}     : ${union. ? union.instantiationParameters.join(", ") : "-"}`);

  for (const variant of union.variants) {
    const s = variant[0];
    // check if symbol is a string
    if (typeof s === "string") {
      console.log(`${"  ".repeat(level + 1)}- variant: ${s}`);
      continue;
    } else {
      const uv: UnionVariant = variant[1] as UnionVariant;
      //s.
      console.log(
        `${"  ".repeat(level + 1)}- variant: ${s.description} - ${JSON.stringify(uv.kind)}`
      );
    }
    //console.log(`${"  ".repeat(level + 1)}- variant: ${variant[0].valueOf()} - ${JSON.stringify(variant[1].kind)}`);
  }
  console.log("\n");
};
*/