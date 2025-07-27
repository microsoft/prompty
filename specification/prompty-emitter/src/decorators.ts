import { type BooleanLiteral, type StringLiteral, type DecoratorContext, type Model, type Union, getTypeName, Program, Type } from "@typespec/compiler";
import { StateKeys } from "./lib.js";

export function $resolve(context: DecoratorContext, target: Union, name: string | StringLiteral, type: Model, docsOnly?: boolean | undefined | BooleanLiteral) {
  const typeName = typeof name === 'object' && 'value' in name ? name.value : name;
  const onlyDocs = typeof docsOnly === 'object' && 'value' in docsOnly ? docsOnly.value : docsOnly ?? false;
  //console.debug(`Resolving Union: ${target.name} with name: ${typeName} and type: ${type.name}, onlyDocs: ${onlyDocs}`);
  appendUnionResolution(context, target, typeName, type, onlyDocs);
}

export interface Resolution {
  name: string;
  type: Type;
  onlyDocs: boolean;
}

export function getUnionResolution(program: Program, target: Type): Resolution[] {
  return program.stateMap(StateKeys.unionResolution).get(target) || [];
}

export function appendUnionResolution(context: DecoratorContext, target: Type, name: string, type: Model, onlyDocs: boolean) {
  // Append the resolution information to the target's state
  const state = context.program.stateMap(StateKeys.unionResolution).get(target) || [];
  const newState = [{ name, type, onlyDocs }, ...state];
  context.program.stateMap(StateKeys.unionResolution).set(target, newState);
}