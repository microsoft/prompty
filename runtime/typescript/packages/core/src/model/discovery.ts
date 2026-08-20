import * as fs from "fs";

import { ModelInfo } from "./contracts/models/model-info.js";

type CapabilityEntry = {
  prefix?: unknown;
  contextWindow?: unknown;
  inputModalities?: unknown;
  outputModalities?: unknown;
};

type CapabilityDataset = {
  providers?: Record<string, CapabilityEntry[]>;
};

let cachedDataset: CapabilityDataset | undefined;

function getDataset(): CapabilityDataset {
  if (cachedDataset === undefined) {
    const contents = fs.readFileSync(new URL("./model_capabilities.json", import.meta.url), "utf-8");
    cachedDataset = JSON.parse(contents) as CapabilityDataset;
  }
  return cachedDataset;
}

function isTokenBoundary(modelId: string, prefix: string): boolean {
  return modelId === prefix || (modelId.startsWith(prefix) && !/[A-Za-z0-9]/.test(modelId[prefix.length] ?? ""));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function setStringField(target: ModelInfo, field: "id" | "displayName" | "ownedBy", value: unknown): void {
  if (value !== undefined && value !== null) {
    target[field] = String(value);
  }
}

function setNumberField(target: ModelInfo, field: "contextWindow", value: unknown): void {
  if (value !== undefined && value !== null) {
    target[field] = Number(value);
  }
}

function setStringArrayField(
  target: ModelInfo,
  field: "inputModalities" | "outputModalities",
  value: unknown,
): void {
  if (value !== undefined && value !== null) {
    target[field] = Array.isArray(value) ? value.map(item => String(item)) : [];
  }
}

export function matchCapabilities(modelId: string, provider: string): CapabilityEntry | null {
  const entries = getDataset().providers?.[provider];
  if (!entries) {
    return null;
  }

  let best: CapabilityEntry | null = null;
  let bestLength = -1;
  for (const entry of entries) {
    if (typeof entry.prefix !== "string") {
      continue;
    }
    if (entry.prefix.length > bestLength && isTokenBoundary(modelId, entry.prefix)) {
      best = entry;
      bestLength = entry.prefix.length;
    }
  }
  return best;
}

export function enrich(base: ModelInfo, provider: string): ModelInfo {
  const entry = matchCapabilities(base.id, provider);
  if (entry === null) {
    return base;
  }

  if (base.contextWindow === undefined || base.contextWindow === null) {
    if (entry.contextWindow !== undefined && entry.contextWindow !== null) {
      base.contextWindow = structuredClone(entry.contextWindow) as number;
    }
  }
  if (base.inputModalities === undefined || base.inputModalities === null) {
    if (entry.inputModalities !== undefined && entry.inputModalities !== null) {
      base.inputModalities = structuredClone(entry.inputModalities) as string[];
    }
  }
  if (base.outputModalities === undefined || base.outputModalities === null) {
    if (entry.outputModalities !== undefined && entry.outputModalities !== null) {
      base.outputModalities = structuredClone(entry.outputModalities) as string[];
    }
  }
  return base;
}

export function mapModel(raw: unknown, provider: string): ModelInfo {
  const data = asRecord(raw);
  const info = new ModelInfo();
  info.additionalProperties = data;

  switch (provider) {
    case "anthropic":
      setStringField(info, "id", data.id);
      setStringField(info, "displayName", data.display_name);
      info.ownedBy = "anthropic";
      setNumberField(info, "contextWindow", data.context_length);
      setStringArrayField(info, "inputModalities", data.input_modalities);
      setStringArrayField(info, "outputModalities", data.output_modalities);
      break;
    case "foundry":
      if ("properties" in data) {
        const props = asRecord(data.properties);
        const model = asRecord(props.model);
        const caps = asRecord(props.capabilities);
        setStringField(info, "id", data.name);
        setStringField(info, "displayName", model.name);
        setStringField(info, "ownedBy", model.publisher);
        setNumberField(info, "contextWindow", model.maxContextLength);
        setStringArrayField(info, "inputModalities", caps.supportedInputModalities);
        setStringArrayField(info, "outputModalities", caps.supportedOutputModalities);
      } else if ("modelName" in data || data.type === "ModelDeployment") {
        setStringField(info, "id", data.name);
        setStringField(info, "displayName", data.modelName);
        setStringField(info, "ownedBy", data.modelPublisher);
        setNumberField(info, "contextWindow", data.maxContextLength);
      } else {
        setStringField(info, "id", data.id);
        setStringField(info, "ownedBy", data.owned_by);
        setNumberField(info, "contextWindow", data.maxContextLength);
      }
      break;
    default:
      setStringField(info, "id", data.id);
      setStringField(info, "ownedBy", data.owned_by);
      break;
  }

  if (info.id === undefined || info.id === null) {
    info.id = "";
  }
  return info;
}
