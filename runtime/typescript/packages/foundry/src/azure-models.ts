/**
 * Azure OpenAI and Foundry model discovery.
 *
 * @module
 */

import { AzureOpenAI } from "openai";
import { ModelInfo, ApiKeyConnection, FoundryConnection, ReferenceConnection, getConnection } from "@prompty/core";
import type { Connection } from "@prompty/core";

interface FoundryDeployment {
  name: string;
  properties?: {
    model?: {
      name?: string;
      publisher?: string;
      maxContextLength?: number;
      capabilities?: Record<string, unknown>;
    };
    capabilities?: Record<string, unknown>;
  };
}

interface FoundryDeploymentsResponse {
  value?: FoundryDeployment[];
}

interface FoundryDeploymentClient {
  projectEndpoint: string;
  getToken: () => Promise<string>;
}

/**
 * List deployments available from a Foundry project, or models from an Azure OpenAI resource.
 *
 * Foundry project endpoints return deployments; Azure OpenAI resource endpoints return model catalog entries.
 * Both are mapped to `ModelInfo` so callers can present selectable model/deployment ids.
 */
export async function listAzureModels(connection: Connection): Promise<ModelInfo[]> {
  if (connection instanceof FoundryConnection) {
    if (!connection.endpoint) {
      throw new Error("FoundryConnection requires a non-empty endpoint to list deployments.");
    }
    const { DefaultAzureCredential } = await import("@azure/identity");
    const credential = new DefaultAzureCredential();
    return listFoundryDeployments(connection.endpoint, async () => {
      const token = await credential.getToken("https://ai.azure.com/.default");
      if (!token?.token) {
        throw new Error("DefaultAzureCredential did not return an access token.");
      }
      return token.token;
    });
  }

  if (connection instanceof ReferenceConnection) {
    const registered = getConnection(connection.name);
    if (isFoundryDeploymentClient(registered)) {
      return listFoundryDeployments(registered.projectEndpoint, registered.getToken);
    }
    return listAzureOpenAIModels(registered as AzureOpenAI);
  }

  const client = buildAzureOpenAIClient(connection);
  return listAzureOpenAIModels(client);
}

async function listAzureOpenAIModels(client: AzureOpenAI): Promise<ModelInfo[]> {
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

async function listFoundryDeployments(
  projectEndpoint: string,
  getToken: () => Promise<string>,
): Promise<ModelInfo[]> {
  const endpoint = projectEndpoint.replace(/\/$/, "");
  const token = await getToken();
  const response = await fetch(`${endpoint}/deployments?api-version=v1`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to list Foundry deployments: ${response.status} ${response.statusText} — ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as FoundryDeploymentsResponse;
  return (data.value ?? []).map((deployment) => {
    const capabilities = deployment.properties?.capabilities ?? deployment.properties?.model?.capabilities;
    return new ModelInfo({
      id: deployment.name,
      displayName: deployment.properties?.model?.name,
      ownedBy: deployment.properties?.model?.publisher ?? "azure",
      contextWindow: getNumber(capabilities, ["maxContextLength", "contextWindow", "context_length"])
        ?? deployment.properties?.model?.maxContextLength,
      inputModalities: getStringArray(capabilities, ["inputModalities", "input_modalities", "supportedInputModalities"]),
      outputModalities: getStringArray(capabilities, ["outputModalities", "output_modalities", "supportedOutputModalities"]),
      additionalProperties: deployment as unknown as Record<string, unknown>,
    });
  });
}

function getNumber(source: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function getStringArray(source: Record<string, unknown> | undefined, keys: string[]): string[] | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value.map((v) => String(v));
    if (typeof value === "string" && value.trim()) {
      return value.split(",").map((v) => v.trim()).filter(Boolean);
    }
  }
  return undefined;
}

function isFoundryDeploymentClient(client: unknown): client is FoundryDeploymentClient {
  return typeof client === "object"
    && client !== null
    && typeof (client as FoundryDeploymentClient).projectEndpoint === "string"
    && typeof (client as FoundryDeploymentClient).getToken === "function";
}

function buildAzureOpenAIClient(connection: Connection): AzureOpenAI {
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
