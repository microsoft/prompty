import { type DecoratorContext, type Model, Program, Type, ModelProperty, ObjectValue, serializeValueAsJson } from "@typespec/compiler";
import { StateKeys } from "./lib.js";


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
  alternate: object;
  expansion: object;
  title?: string;
  description?: string;
}

export function $alternate(context: DecoratorContext, target: ModelProperty, sample: ObjectValue, expansion: ObjectValue, options?: SampleOptions) {
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
  const entry: AlternateEntry = {
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
