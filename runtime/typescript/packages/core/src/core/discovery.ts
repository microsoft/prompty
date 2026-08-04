/**
 * Shared model-discovery capability enrichment.
 *
 * Capability data comes from the canonical cross-runtime dataset. Provider
 * values are preserved; the dataset only fills fields omitted by the provider.
 *
 * @module
 */

import capabilities from "../../../../../../spec/data/model_capabilities.json";

import { ModelInfo } from "../model/model/model-info.js";

interface CapabilityEntry {
  prefix: string;
  contextWindow?: number;
  inputModalities?: string[];
  outputModalities?: string[];
}

interface CapabilityDataset {
  providers: Record<string, CapabilityEntry[] | undefined>;
}

const dataset = capabilities as CapabilityDataset;

function isTokenBoundary(id: string, prefix: string): boolean {
  if (!id.startsWith(prefix)) return false;
  if (id.length === prefix.length) return true;
  return !/[A-Za-z0-9]/.test(id[prefix.length]);
}

function findCapabilities(provider: string, id: string): CapabilityEntry | undefined {
  return (dataset.providers[provider] ?? [])
    .filter((entry) => isTokenBoundary(id, entry.prefix))
    .sort((left, right) => right.prefix.length - left.prefix.length)[0];
}

/**
 * Fill omitted model capability fields from the shared dataset.
 *
 * Accepts a partial generated `ModelInfo` initializer so an explicit empty
 * modality list remains distinguishable from an omitted field.
 */
export function enrichModelInfo(provider: string, input: Partial<ModelInfo>): Partial<ModelInfo> {
  const known = findCapabilities(provider, input.id ?? "");
  if (!known) return { ...input };

  return {
    ...input,
    contextWindow: input.contextWindow ?? known.contextWindow,
    inputModalities: input.inputModalities === undefined ? known.inputModalities : input.inputModalities,
    outputModalities: input.outputModalities === undefined ? known.outputModalities : input.outputModalities,
  };
}

/**
 * Construct a generated `ModelInfo` without materializing omitted optional
 * collection fields as empty arrays.
 */
export function createModelInfo(input: Partial<ModelInfo>): ModelInfo {
  const info = new ModelInfo(input);
  if (input.inputModalities === undefined) delete info.inputModalities;
  if (input.outputModalities === undefined) delete info.outputModalities;
  return info;
}
