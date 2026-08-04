/**
 * OpenAI model discovery — lists available models and enriches with known metadata.
 *
 * @module
 */

import OpenAI from "openai";
import {
  ApiKeyConnection,
  ModelInfo,
  ReferenceConnection,
  createModelInfo,
  enrichModelInfo,
  getConnection,
} from "@prompty/core";
import type { Connection } from "@prompty/core";

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
    models.push(modelInfoFromWire(m as unknown as Record<string, unknown>));
  }

  return models;
}

/** Map one raw OpenAI model response into the canonical generated model. */
export function modelInfoFromWire(raw: Record<string, unknown>): ModelInfo {
  return createModelInfo(enrichModelInfo("openai", {
    id: typeof raw.id === "string" ? raw.id : "",
    ownedBy: typeof raw.owned_by === "string" ? raw.owned_by : undefined,
    additionalProperties: { ...raw },
  }));
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
