import { type DecoratorContext, type Model, Program, Type, ModelProperty, ObjectValue, serializeValueAsJson } from "@typespec/compiler";
import { StateKeys } from "./lib.js";
import { Scalar } from "yaml";


export interface SampleOptions {
  title?: string;
  description?: string;
}

export const appendStateValue = <T>(context: DecoratorContext, key: symbol, target: Type, value: T | T[]) => {
  const state = context.program.stateMap(key).get(target) || [];
  // check if value is array
  if (Array.isArray(value)) {
    const newState = [...state, ...value];
    context.program.stateMap(key).set(target, newState);
  } else {
    const newState = [...state, value];
    context.program.stateMap(key).set(target, newState);
  }
};

export const getStateValue = <T>(program: Program, key: symbol, target: Type): T[] => {
  return program.stateMap(key).get(target) || [];
};

export const setStateScalar = <T>(context: DecoratorContext, key: symbol, target: Type, value: T) => {
  context.program.stateMap(key).set(target, value);
};

export const getStateScalar = <T>(program: Program, key: symbol, target: Type): T | undefined => {
  const value = program.stateMap(key).get(target);
  return value ? value : undefined;
};

export interface SampleEntry {
  sample: object;
  title?: string;
  description?: string;
}

export function $sample(context: DecoratorContext, target: ModelProperty, sample: ObjectValue, options?: SampleOptions) {
  const s = serializeValueAsJson(context.program, sample, sample.type);
  if (!s) {
    context.program.reportDiagnostic({
      code: "prompty-emitter-sample-serialization",
      message: `Failed to serialize sample value.`,
      severity: "error",
      target: sample,
    });
    return;
  }
  if (!s.hasOwnProperty(target.name)) {
    context.program.reportDiagnostic({
      code: "prompty-emitter-sample-name-mismatch",
      message: `Sample object must have a property named '${target.name}' to match the target property.`,
      severity: "error",
      target: sample,
    });
    return;
  }
  const entry: SampleEntry = {
    sample: s,
    title: options?.title ?? "",
    description: options?.description ?? "",
  }
  appendStateValue<SampleEntry>(context, StateKeys.samples, target, entry);
}

export interface AlternateEntry {
  scalar: string;
  alternate: {
    [key: string]: any;
  };
  expansion: {
    [key: string]: any;
  };
  title?: string;
  description?: string;
}

export function $alternate(context: DecoratorContext, target: ModelProperty, scalar: Type, sample: ObjectValue, expansion: ObjectValue, options?: SampleOptions) {
  const alt = serializeValueAsJson(context.program, sample, sample.type);
  if (!alt) {
    context.program.reportDiagnostic({
      code: "prompty-emitter-alternate-serialization",
      message: `Failed to serialize alternate value.`,
      severity: "error",
      target: target,
    });
    return;
  }
  if (!alt.hasOwnProperty(target.name)) {
    context.program.reportDiagnostic({
      code: "prompty-emitter-alternate-name-mismatch",
      message: `Alternate object must have a property named '${target.name}' to match the target property.`,
      severity: "error",
      target: target,
    });
    return;
  }
  const exp = serializeValueAsJson(context.program, expansion, expansion.type);
  if (!exp) {
    context.program.reportDiagnostic({
      code: "prompty-emitter-expansion-serialization",
      message: `Failed to serialize expansion value.`,
      severity: "error",
      target: target,
    });
    return;
  }
  if (!exp.hasOwnProperty(target.name)) {
    context.program.reportDiagnostic({
      code: "prompty-emitter-expansion-name-mismatch",
      message: `Expansion object must have a property named '${target.name}' to match the target property.`,
      severity: "error",
      target: target,
    });
    return;
  }
  if(scalar.kind !== "Scalar") {
    context.program.reportDiagnostic({
      code: "prompty-emitter-alternate-scalar-type",
      message: `Alternate decorator requires a scalar type for the alternate representation.`,
      severity: "error",
      target: scalar,
    });
    return;
  }
  // check that scalar type is contained in the union of values of the target property
  if (target.type.kind !== "Union") {
    context.program.reportDiagnostic({
      code: "prompty-emitter-alternate-target-type",
      message: `Alternate decorator requires the target property to be a union type.`,
      severity: "error",
      target: target,
    });
    return;
  }

  const variants = Array.from(target.type.variants).map(([, v]) => v.type)
  // check if duplicate scalar value already exists as alternate
  const currentAlternates = getStateValue<AlternateEntry>(context.program, StateKeys.alternates, target);
  for (const variant of variants) {
    if (variant.kind === "Scalar" && variant.name === scalar.name) {
      // check if this variant is already in the current alternates
      if (currentAlternates.find(a => a.scalar === scalar.name)) {
        context.program.reportDiagnostic({
          code: "prompty-emitter-alternate-duplicate",
          message: `Alternate with scalar value '${scalar.name}' and alternate representation already exists on target property.`,
          severity: "error",
          target: target,
        });
        return;
      }
    }
  }
  // check if the sclar value exists in the union of target property
  if (!variants.find(v => v.kind === "Scalar" && v.name === scalar.name)) {
    context.program.reportDiagnostic({
      code: "prompty-emitter-alternate-scalar-mismatch",
      message: `Alternate scalar value '${scalar.name}' does not exist in the union of target property types.`,
      severity: "error",
      target: target,
    });
    return;
  }

  const entry: AlternateEntry = {
    scalar: scalar.name,
    alternate: alt,
    expansion: exp,
    title: options?.title ?? "",
    description: options?.description ?? "",
  }
  appendStateValue<AlternateEntry>(context, StateKeys.alternates, target, entry);
}

export function $abstract(context: DecoratorContext, target: Model) {
  setStateScalar(context, StateKeys.abstracts, target, true);
}
