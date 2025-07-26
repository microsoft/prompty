import {
  getDiscriminatedTypes,
  getDoc,
  getEntityName,
  getPropertyType,
  getTypeName,
  isTemplateInstance,
  Model,
  ModelProperty,
  Program,
  TemplatedType,
  Type,
  Union,
  UnionVariant,
} from "@typespec/compiler";
import * as ay from "@alloy-js/core";
import { ModelDescription } from "./ModelDescription.jsx";

interface UnionProps {
  program: Program;
  union: Union;
  recursive?: boolean;
}

interface VariantTemplateType {
  variant: UnionVariant;
  type: TemplatedType;
  templateType: Type;
}

export const UnionDescription = ({ program, union, recursive }: UnionProps) => {
  //const docs = getDoc(program, union) || "No description available.";
  //union.variants.size === 2 && union.variants.has()

  const variants: VariantTemplateType[] = [];
  if (union.variants) {
    for (const [_, value] of union.variants) {
      if (isTemplateInstance(value.type)) {
        const templateType = value.type.templateMapper?.args.at(0);
        if (
          value.type.templateMapper?.args.length === 1 &&
          templateType !== undefined &&
          templateType.entityKind === "Type"
        ) {
          variants.push({
            variant: value,
            type: value.type,
            templateType: templateType,
          });
        }
      }
    }
  }

  return (
    <>
      <ay.For each={variants}>
        {(value: VariantTemplateType) => {
          const name = getEntityName(value.variant, {
            nameOnly: true,
            printable: true,
          });

          return (
            <>
              <>
                {`# ${name
                  .replaceAll("|", " or")
                  .replaceAll("<", "&lt;")
                  .replaceAll(">", "&gt;")}`}
              </>
              <br />
              <br />
              <>{`- ${getEntityName(value.templateType)
                .replaceAll("|", " or")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")}`}</>
              <br />
              <br />
              <>
                {value.type.kind === "Model" && (
                  <ModelDescription
                    program={program}
                    model={value.templateType as Model}
                    recursive={recursive || false}
                  />
                )}
                {value.type.kind === "Union" && (
                  <UnionDescription
                    program={program}
                    union={value.templateType as Union}
                    recursive={recursive || false}
                  />
                )}
              </>
            </>
          );
        }}
      </ay.For>
    </>
  );
};
