/**
 * Azure OpenAI model discovery — lists models from an Azure OpenAI deployment.
 *
 * @module
 */

import { AzureOpenAI } from "openai";
import { ModelInfo, ApiKeyConnection, ReferenceConnection, getConnection } from "@prompty/core";
import type { Connection } from "@prompty/core";

/**
 * List models available from an Azure OpenAI resource.
 *
 * Calls the Azure OpenAI models endpoint and maps each result to a `ModelInfo`.
 * Modalities are left undefined since the Azure API does not return them.
 */
export async function listAzureModels(connection: Connection): Promise<ModelInfo[]> {
  const client = buildClient(connection);
  const page = await client.models.list();
  const models: ModelInfo[] = [];

  for (const m of page.data) {
    const raw = m as unknown as Record<string, unknown>;
    models.push(
      new ModelInfo({
        id: m.id,
        ownedBy: m.owned_by,
        // Azure may return maxContextLength in capabilities
        contextWindow: typeof raw["maxContextLength"] === "number" ? raw["maxContextLength"] : undefined,
      }),
    );
  }

  return models;
}

function buildClient(connection: Connection): AzureOpenAI {
  if (connection instanceof ReferenceConnection) {
    return getConnection(connection.name) as AzureOpenAI;
  }

  const kwargs: Record<string, unknown> = {};
  if (connection instanceof ApiKeyConnection) {
    if (connection.apiKey) kwargs.apiKey = connection.apiKey;
    if (connection.endpoint) kwargs.endpoint = connection.endpoint;
  } else {
    throw new Error(
      `Connection kind '${connection.kind}' is not supported by Azure listModels. ` +
        `Use 'key' for API key auth or 'reference' with registerConnection() for pre-configured clients.`,
    );
  }
  return new AzureOpenAI(kwargs as ConstructorParameters<typeof AzureOpenAI>[0]);
}
