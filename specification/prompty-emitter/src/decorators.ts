import { type BooleanLiteral, type StringLiteral, type DecoratorContext, type Model, type Union, getTypeName, Program, Type, ModelProperty } from "@typespec/compiler";
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

export interface SampleEntry {
  sample: unknown;
  title?: string;
  description?: string;
}

export function $sample(context: DecoratorContext, target: ModelProperty, sample: unknown, options?: SampleOptions) {
  const entry: SampleEntry = {
    sample,
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

export function $alternate(context: DecoratorContext, target: ModelProperty, sample: unknown, expansion: unknown, options?: SampleOptions) {
  const entry: AlternateEntry = {
    alternate: sample,
    expansion: expansion,
    title: options?.title ?? "",
    description: options?.description ?? "",
  }
  appendStateValue<AlternateEntry>(context, StateKeys.alternates, target, entry);
}


export function $allowed(context: DecoratorContext, target: ModelProperty, values: string[]) {
  appendStateValue<string>(context, StateKeys.allowedValues, target, values);
}
