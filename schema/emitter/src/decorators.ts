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

export function $sample(context: DecoratorContext, target: ModelProperty, sample: ObjectValue | object, options?: SampleOptions) {
  // With valueof unknown, TypeSpec passes a plain JavaScript object
  // With unknown (no valueof), TypeSpec passes an ObjectValue with a type property
  let s: object;

  if (sample && typeof sample === 'object' && 'type' in sample && (sample as ObjectValue).type) {
    // Old-style ObjectValue with type property
    const sampleValue = sample as ObjectValue;
    const serialized = serializeValueAsJson(context.program, sampleValue, sampleValue.type);
    if (!serialized) {
      context.program.reportDiagnostic({
        code: "agentschema-emitter-sample-serialization",
        message: `Failed to serialize sample value.`,
        severity: "error",
        target: sampleValue,
      });
      return;
    }
    s = serialized;
  } else {
    // New-style: plain JavaScript object from valueof unknown
    s = sample as object;
  }

  if (!s.hasOwnProperty(target.name)) {
    context.program.reportDiagnostic({
      code: "agentschema-emitter-sample-name-mismatch",
      message: `Sample object must have a property named '${target.name}' to match the target property.`,
      severity: "error",
      target: target,
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

export function $alternate(context: DecoratorContext, target: ModelProperty, scalar: Type, sample: ObjectValue | object, expansion: ObjectValue | object) {
  // The alternate decorator provides an alternative sample value with its expansion
  // Currently a stub - can be extended later if needed
  if (scalar.kind !== "Scalar") {
    context.program.reportDiagnostic({
      code: "agentschema-emitter-alternate-scalar-type",
      message: `Alternate decorator requires a scalar type.`,
      severity: "error",
      target: scalar,
    });
    return;
  }
  // For now, this is a no-op placeholder
  // The functionality can be implemented when @alternate is actually used
}


export function $shorthand(context: DecoratorContext, target: Model, scalar: Type, expansion: ObjectValue | object, title?: string, description?: string, example?: string) {
  if (scalar.kind !== "Scalar") {
    context.program.reportDiagnostic({
      code: "agentschema-emitter-shorthand-scalar-type",
      message: `Shorthand decorator requires a scalar type for the shorthand representation.`,
      severity: "error",
      target: scalar,
    });
    return;
  }

  // Handle both ObjectValue (old style) and plain object (valueof unknown)
  let exp: object;
  if (expansion && typeof expansion === 'object' && 'type' in expansion && (expansion as ObjectValue).type) {
    const serialized = serializeValueAsJson(context.program, expansion as ObjectValue, (expansion as ObjectValue).type);
    if (!serialized) {
      context.program.reportDiagnostic({
        code: "agentschema-emitter-shorthand-serialization",
        message: `Failed to serialize expansion value.`,
        severity: "error",
        target: target,
      });
      return;
    }
    exp = serialized;
  } else {
    exp = expansion as object;
  }

  // Handle string parameters that come as plain strings from valueof
  const titleValue = typeof title === 'object' && title !== null && 'value' in title ? (title as StringValue).value : title as string | undefined;
  const descValue = typeof description === 'object' && description !== null && 'value' in description ? (description as StringValue).value : description as string | undefined;
  const exampleValue = typeof example === 'object' && example !== null && 'value' in example ? (example as StringValue).value : example as string | undefined;

  const entry: Alternative = {
    scalar: scalar.name,
    expansion: exp,
    example: exampleValue,
    title: titleValue ?? "",
    description: descValue ?? "",
  }
  appendStateValue<Alternative>(context, StateKeys.shorthands, target, entry);
}
