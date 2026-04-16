import { type DecoratorContext, type Model, Program, Type, ModelProperty, ObjectValue, serializeValueAsJson, StringValue } from "@typespec/compiler";
import { StateKeys } from "./lib.js";
import { Coercion } from "./ir/ast.js";

export const appendStateValue = <T>(context: DecoratorContext, key: symbol, target: Type, value: T | T[]) => {
  const state = context.program.stateMap(key).get(target) || [];
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

export interface SampleOptions {
  title?: string;
  description?: string;
}

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
        code: "prompty-emitter-sample-serialization",
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
      code: "prompty-emitter-sample-name-mismatch",
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

export function $abstract(context: DecoratorContext, target: Model) {
  setStateScalar(context, StateKeys.abstracts, target, true);
}

export function $coerce(context: DecoratorContext, target: Model, scalar: Type, expansion: ObjectValue | object, title?: string, description?: string, example?: string) {
  if (scalar.kind !== "Scalar") {
    context.program.reportDiagnostic({
      code: "prompty-emitter-coerce-scalar-type",
      message: `Coerce decorator requires a scalar type for the scalar representation.`,
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
        code: "prompty-emitter-coerce-serialization",
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

  const entry: Coercion = {
    scalar: scalar.name,
    expansion: exp,
    example: exampleValue,
    title: titleValue ?? "",
    description: descValue ?? "",
  }
  appendStateValue<Coercion>(context, StateKeys.coercions, target, entry);
}

// ============================================================================
// Factory and Method decorators
// ============================================================================

export interface FactoryEntry {
  /** Factory method name (e.g., "allow", "deny") */
  name: string;
  /** Field assignments — { fieldName: value } */
  sets: Record<string, any>;
  /** Optional parameters — { paramName: typeString } */
  params: Record<string, string>;
}

export interface MethodEntry {
  /** Method name (e.g., "text") */
  name: string;
  /** Return type as a string (e.g., "string") */
  returns: string;
  /** Human-readable description of what the method does */
  description: string;
}

function deserializeValue(value: unknown): any {
  if (value && typeof value === 'object' && 'type' in value && (value as ObjectValue).type) {
    // ObjectValue from TypeSpec — shouldn't happen with valueof but handle defensively
    return value;
  }
  return value;
}

export function $factory(context: DecoratorContext, target: Model, name: string, sets: object, params?: object) {
  // Handle string values from valueof
  const nameValue = typeof name === 'object' && name !== null && 'value' in name ? (name as StringValue).value : name as string;

  const setsValue = deserializeValue(sets) as Record<string, any>;
  const paramsValue = params ? deserializeValue(params) as Record<string, string> : {};

  const entry: FactoryEntry = {
    name: nameValue,
    sets: setsValue,
    params: paramsValue,
  };

  appendStateValue<FactoryEntry>(context, StateKeys.factories, target, entry);
}

export function $method(context: DecoratorContext, target: Model, name: string, returns: string, description?: string) {
  const nameValue = typeof name === 'object' && name !== null && 'value' in name ? (name as StringValue).value : name as string;
  const returnsValue = typeof returns === 'object' && returns !== null && 'value' in returns ? (returns as StringValue).value : returns as string;
  const descValue = typeof description === 'object' && description !== null && 'value' in description ? (description as StringValue).value : description as string | undefined;

  const entry: MethodEntry = {
    name: nameValue,
    returns: returnsValue,
    description: descValue ?? "",
  };

  appendStateValue<MethodEntry>(context, StateKeys.methods, target, entry);
}

// ============================================================================
// Wire mapping decorators (@knownAs, @defaultFor)
// ============================================================================

export interface KnownAsEntry {
  /** Provider identifier (e.g., "openai", "anthropic") */
  provider: string;
  /** Wire field name for that provider */
  name: string;
}

export function $knownAs(context: DecoratorContext, target: ModelProperty, provider: string, name: string) {
  const providerValue = typeof provider === 'object' && provider !== null && 'value' in provider ? (provider as StringValue).value : provider as string;
  const nameValue = typeof name === 'object' && name !== null && 'value' in name ? (name as StringValue).value : name as string;

  const entry: KnownAsEntry = { provider: providerValue, name: nameValue };
  appendStateValue<KnownAsEntry>(context, StateKeys.knownAs, target, entry);
}

export interface DefaultForEntry {
  /** Provider identifier (e.g., "openai", "anthropic") */
  provider: string;
  /** Default value for that provider */
  defaultValue: any;
}

export function $defaultFor(context: DecoratorContext, target: ModelProperty, provider: string, defaultValue: ObjectValue | object | string | number | boolean) {
  const providerValue = typeof provider === 'object' && provider !== null && 'value' in provider ? (provider as StringValue).value : provider as string;

  let val: any;
  if (defaultValue && typeof defaultValue === 'object' && 'type' in defaultValue && (defaultValue as ObjectValue).type) {
    const serialized = serializeValueAsJson(context.program, defaultValue as ObjectValue, (defaultValue as ObjectValue).type);
    if (!serialized) {
      context.program.reportDiagnostic({
        code: "prompty-emitter-defaultfor-serialization",
        message: `Failed to serialize default value.`,
        severity: "error",
        target: target,
      });
      return;
    }
    val = serialized;
  } else {
    val = defaultValue;
  }

  const entry: DefaultForEntry = { provider: providerValue, defaultValue: val };
  appendStateValue<DefaultForEntry>(context, StateKeys.defaultFor, target, entry);
}

// ============================================================================
// Protocol decorator
// ============================================================================

export function $protocol(context: DecoratorContext, target: Model) {
  setStateScalar(context, StateKeys.protocols, target, true);
}
