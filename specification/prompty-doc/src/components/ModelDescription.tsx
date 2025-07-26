import {
  getDoc,
  getEntityName,
  getPropertyType,
  getTypeName,
  Model,
  ModelProperty,
  Program,
  Type,
} from "@typespec/compiler";
import * as ay from "@alloy-js/core";
import { UnionDescription } from "./UnionDescription.jsx";

const emitPropertyName = (property: ModelProperty, recursive: boolean) => {
  const type = getPropertyType(property);
  const options = {
    nameOnly: true,
    printable: true,
  };
  const typeName = getTypeName(type, options)
    .replaceAll("|", " or")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  if (type.kind === "Model") {
    if (recursive) {
      return `[${typeName}](#${typeName.toLocaleLowerCase().replaceAll(" ", "-")})`;
    } else {
      return `[${typeName}](${typeName}.md)`;
    }
  } else if (type.kind === "Union") {
    return typeName;
  } else {
    return typeName;
  }
};

interface ModelProps {
  program: Program;
  model: Model;
  recursive?: boolean;
}

export const ModelDescription = ({ program, model, recursive }: ModelProps) => {
  const docs = getDoc(program, model) || "No description available.";
  const hasProperties = model.properties && model.properties.size > 0;
  const modelProperties: ModelProperty[] = [];
  if (recursive) {
    for (const [_, value] of model.properties) {
      const type = getPropertyType(value);
      if (type.kind === "Model" || type.kind === "Union") {
        modelProperties.push(value);
      }
    }
  }

  return (
    <>
      <>{`# ${model.name}`}</>
      <br />
      <>{docs}</>
      <br />
      <br />
      {hasProperties ? (
        <>
          <>{`## Properties`}</>
          <br />
          <>{"| Property | Type | Description |"}</>
          <br />
          <>{`| --- | --- | --- |`}</> <br />
          <ay.For each={model.properties}>
            {(key: string, value: ModelProperty) => {
              const type = getPropertyType(value);
              return (
                <>{`| ${key} | (${type.kind}) ${emitPropertyName(value, recursive || false)} | ${getDoc(program, value)} |`}</>
              );
            }}
          </ay.For>
        </>
      ) : (
        <>{`No concrete properties defined for ${model.name}.`}</>
      )}
      <br />
      <br />
      <ay.For each={modelProperties}>
        {(prop: ModelProperty) => {
          const type = getPropertyType(prop);
          return (
            <>
              {type.kind === "Model" && (
                <ModelDescription
                  program={program}
                  model={type}
                  recursive={true}
                />
              )}
              {type.kind === "Union" && (
                <UnionDescription
                  program={program}
                  union={type}
                  recursive={true}
                />
              )}
            </>
          );
        }}
      </ay.For>
    </>
  );
};
