import { type DecoratorContext, type Model, Program, Type, ModelProperty, ObjectValue, serializeValueAsJson, StringValue } from "@typespec/compiler";
import { StateKeys } from "./lib.js";
import { Alternative } from "./ast.js";

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

export function $abstract(context: DecoratorContext, target: Model) {
  setStateScalar(context, StateKeys.abstracts, target, true);
}


export function $shorthand(context: DecoratorContext, target: Model, scalar: Type, expansion: ObjectValue, title?: StringValue, description?: StringValue) {
  if(scalar.kind !== "Scalar") {
    context.program.reportDiagnostic({
      code: "prompty-emitter-shorthand-scalar-type",
      message: `Shorthand decorator requires a scalar type for the shorthand representation.`,
      severity: "error",
      target: scalar,
    });
    return;
  }

  const exp = serializeValueAsJson(context.program, expansion, expansion.type);
  if (!exp) {
    context.program.reportDiagnostic({
      code: "prompty-emitter-shorthand-serialization",
      message: `Failed to serialize expansion value.`,
      severity: "error",
      target: target,
    });
    return;
  }

  const entry: Alternative = {
    scalar: scalar.name,
    expansion: exp,
    title: title?.value ?? "",
    description: description?.value ?? "",
  }
  appendStateValue<Alternative>(context, StateKeys.shorthands, target, entry);
}
