import { type BooleanLiteral, type StringLiteral, type DecoratorContext, type Model, type Union, getTypeName, Program, Type, ModelProperty, Value, ObjectValue, ArrayValue, Diagnostic, serializeValueAsJson } from "@typespec/compiler";
import { StateKeys } from "./lib.js";
import { serialize } from "v8";


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

export interface SampleEntry {
  sample: unknown;
  title?: string;
  description?: string;
}

export function $sample(context: DecoratorContext, target: ModelProperty, sample: ObjectValue, options?: SampleOptions) {
  const s = serializeValueAsJson(context.program, sample, sample.type);
  
  const entry: SampleEntry = {
    sample: s,
    title: options?.title ?? "",
    description: options?.description ?? "",
  }
  appendStateValue<SampleEntry>(context, StateKeys.samples, target, entry);
}

export interface AlternateEntry {
  alternate: unknown;
  expansion: unknown;
  title?: string;
  description?: string;
}

export function $alternate(context: DecoratorContext, target: ModelProperty, sample: ObjectValue, expansion: ObjectValue, options?: SampleOptions) {
  const alt = serializeValueAsJson(context.program, sample, sample.type);
  const exp = serializeValueAsJson(context.program, expansion, expansion.type);
  const entry: AlternateEntry = {
    alternate: alt,
    expansion: exp,
    title: options?.title ?? "",
    description: options?.description ?? "",
  }
  appendStateValue<AlternateEntry>(context, StateKeys.alternates, target, entry);
}


export function $allowed(context: DecoratorContext, target: ModelProperty, values: ArrayValue) {

  if (!values.values.every(v => v.valueKind === "StringValue")) {
    context.program.reportDiagnostic({
      code: "prompty-emitter-allowed-string-only",
      message: `@allowed only supports string values for now.`,
      severity: "error",
      target: values,
    });
    return;
  }

  const targetValues = values.values.map(v => v.value as string);
  appendStateValue<string>(context, StateKeys.allowedValues, target, targetValues);
}
