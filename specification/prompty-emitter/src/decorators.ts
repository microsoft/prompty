import { type BooleanLiteral, type StringLiteral, type DecoratorContext, type Model, type Union, getTypeName, Program, Type, ModelProperty } from "@typespec/compiler";
import { StateKeys } from "./lib.js";

export function $resolve(context: DecoratorContext, target: Union, name: string | StringLiteral, type: Model, abstract?: boolean | undefined | BooleanLiteral) {
  const typeName = typeof name === 'object' && 'value' in name ? name.value : name;
  const isAbstract = typeof abstract === 'object' && 'value' in abstract ? abstract.value : abstract ?? false;
  //console.debug(`Resolving Union: ${target.name} with name: ${typeName} and type: ${type.name}, isAbstract: ${isAbstract}`);
  appendUnionResolution(context, target, typeName, type, isAbstract);
}

export function getUnionResolution(program: Program, target: Type): Resolution[] {
  return program.stateMap(StateKeys.unionResolution).get(target) || [];
}

export function appendUnionResolution(context: DecoratorContext, target: Type, name: string, type: Model, abstract: boolean) {
  // Append the resolution information to the target's state
  const state = context.program.stateMap(StateKeys.unionResolution).get(target) || [];
  const newState = [{ name, type, abstract }, ...state];
  context.program.stateMap(StateKeys.unionResolution).set(target, newState);
}


export interface SampleOptions {
  title?: string;
  description?: string;
}

export interface Resolution {
  name: string;
  type: Type;
  abstract: boolean;
}

export function $sample(context: DecoratorContext, target: ModelProperty, sample: unknown, options?: SampleOptions) {
  //const sampleValue = typeof sample === 'object' && 'value' in sample ? sample.value : sample;
  const title = options?.title ?? `Sample for ${target.name}`;
  const description = options?.description ?? `A sample value for ${target.name}`;
  //console.debug(`Adding sample to Union: ${target.name} with sample: ${sampleValue}`);
}

export function $alternate(context: DecoratorContext, target: ModelProperty, sample: unknown, expansion: unknown, options?: SampleOptions) {
  const title = options?.title ?? `Alternate for ${target.name}`;
  const description = options?.description ?? `An alternate value for ${target.name}`;
  //console.debug(`Adding sample to Union: ${target.name} with sample: ${sampleValue} and expansion: ${expansionValue}`);
}


export function $allowed(context: DecoratorContext, target: ModelProperty, values: string[]) {
  console.debug(`Adding allowed values to Union: ${target.name} with values: ${values}`);
}
