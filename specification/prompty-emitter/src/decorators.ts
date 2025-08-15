import { type BooleanLiteral, type StringLiteral, type DecoratorContext, type Model, type Union, getTypeName, Program, Type } from "@typespec/compiler";
import { StateKeys } from "./lib.js";

export function $resolve(context: DecoratorContext, target: Union, name: string | StringLiteral, type: Model, abstract?: boolean | undefined | BooleanLiteral) {
  const typeName = typeof name === 'object' && 'value' in name ? name.value : name;
  const isAbstract = typeof abstract === 'object' && 'value' in abstract ? abstract.value : abstract ?? false;
  //console.debug(`Resolving Union: ${target.name} with name: ${typeName} and type: ${type.name}, isAbstract: ${isAbstract}`);
  appendUnionResolution(context, target, typeName, type, isAbstract);
}

export interface Resolution {
  name: string;
  type: Type;
  abstract: boolean;
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