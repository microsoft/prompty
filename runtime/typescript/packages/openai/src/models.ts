/**
 * OpenAI model discovery — lists available models and enriches with known metadata.
 *
 * @module
 */

import OpenAI from "openai";
import { ModelInfo, ApiKeyConnection, ReferenceConnection, getConnection } from "@prompty/core";
import type { Connection } from "@prompty/core";

/** Known model metadata for enrichment (context windows and modalities). */
const KNOWN_MODELS: Record<string, { contextWindow?: number; inputModalities: string[]; outputModalities: string[] }> = {
  "gpt-4o": { contextWindow: 128_000, inputModalities: ["text", "image"], outputModalities: ["text"] },
  "gpt-4o-mini": { contextWindow: 128_000, inputModalities: ["text", "image"], outputModalities: ["text"] },
  "gpt-4-turbo": { contextWindow: 128_000, inputModalities: ["text", "image"], outputModalities: ["text"] },
  "gpt-4": { contextWindow: 8_192, inputModalities: ["text"], outputModalities: ["text"] },
  "gpt-3.5-turbo": { contextWindow: 16_385, inputModalities: ["text"], outputModalities: ["text"] },
  "text-embedding-3-small": { contextWindow: 8_191, inputModalities: ["text"], outputModalities: [] },
  "text-embedding-3-large": { contextWindow: 8_191, inputModalities: ["text"], outputModalities: [] },
  "dall-e-3": { inputModalities: ["text"], outputModalities: ["image"] },
};

/**
 * List models available from the OpenAI API.
 *
 * Calls `GET /v1/models` and maps each result to a `ModelInfo`,
 * enriching with known context window and modality data where available.
 */
export async function listModels(connection: Connection): Promise<ModelInfo[]> {
  const client = buildClient(connection);
  const page = await client.models.list();
  const models: ModelInfo[] = [];

  for (const m of page.data) {
    const known = findKnownModel(m.id);
    models.push(
      new ModelInfo({
        id: m.id,
        ownedBy: m.owned_by,
        contextWindow: known?.contextWindow,
        inputModalities: known?.inputModalities,
        outputModalities: known?.outputModalities,
      }),
    );
  }

  return models;
}

/** Match a model id against known models, supporting prefix matching for dated variants. */
function findKnownModel(id: string): (typeof KNOWN_MODELS)[string] | undefined {
  if (KNOWN_MODELS[id]) return KNOWN_MODELS[id];
  // Try prefix match (e.g. "gpt-4o-2024-08-06" → "gpt-4o")
  for (const key of Object.keys(KNOWN_MODELS)) {
    if (id.startsWith(key + "-")) return KNOWN_MODELS[key];
  }
  return undefined;
}

function buildClient(connection: Connection): OpenAI {
  if (connection instanceof ReferenceConnection) {
    return getConnection(connection.name) as OpenAI;
  }

  const kwargs: Record<string, unknown> = {};
  if (connection instanceof ApiKeyConnection) {
    if (connection.apiKey) kwargs.apiKey = connection.apiKey;
    if (connection.endpoint) kwargs.baseURL = connection.endpoint;
  } else {
    throw new Error(
      `Connection kind '${connection.kind}' is not supported by OpenAI listModels. ` +
        `Use 'key' for API key auth or 'reference' with registerConnection() for pre-configured clients.`,
    );
  }
  return new OpenAI(kwargs);
}
