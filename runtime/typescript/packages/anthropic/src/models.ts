/**
 * Anthropic model discovery.
 *
 * @module
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  ApiKeyConnection,
  ModelInfo,
  ReferenceConnection,
  createModelInfo,
  enrichModelInfo,
  getConnection,
} from "@prompty/core";
import type { Connection } from "@prompty/core";

interface AnthropicModelsClient {
  models: {
    list(params?: { limit?: number; after_id?: string }): Promise<AsyncIterable<unknown>>;
  };
}

/** Map one raw Anthropic model response into the canonical generated model. */
export function modelInfoFromWire(raw: Record<string, unknown>): ModelInfo {
  return createModelInfo(enrichModelInfo("anthropic", {
    id: typeof raw.id === "string" ? raw.id : "",
    displayName: typeof raw.display_name === "string" ? raw.display_name : undefined,
    ownedBy: "anthropic",
    contextWindow: typeof raw.context_length === "number" ? raw.context_length : undefined,
    inputModalities: stringArray(raw.input_modalities),
    outputModalities: stringArray(raw.output_modalities),
    additionalProperties: { ...raw },
  }));
}

/** List every model available from the Anthropic Models API. */
export async function listModels(connection: Connection): Promise<ModelInfo[]> {
  const client = buildClient(connection);
  const page = await client.models.list({ limit: 100 });
  const models: ModelInfo[] = [];

  for await (const raw of page) {
    models.push(modelInfoFromWire(asRecord(raw)));
  }

  return models;
}

function buildClient(connection: Connection): AnthropicModelsClient {
  if (connection instanceof ReferenceConnection) {
    return getConnection(connection.name) as AnthropicModelsClient;
  }
  if (!(connection instanceof ApiKeyConnection)) {
    throw new Error(
      `Connection kind '${connection.kind}' is not supported by Anthropic listModels. ` +
        "Use 'key' for API key auth or 'reference' with registerConnection() for pre-configured clients.",
    );
  }
  return new Anthropic({
    apiKey: connection.apiKey || process.env.ANTHROPIC_API_KEY,
    ...(connection.endpoint ? { baseURL: connection.endpoint } : {}),
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Anthropic model listing returned a non-object model entry.");
  }
  return value as Record<string, unknown>;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map(String) : undefined;
}
