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
 * Map one raw Azure OpenAI model-catalog entry into the provider-neutral
 * `ModelInfo` contract.
 *
 * Exercised by the shared `spec/vectors/discovery` vectors. Mirrors
 * `parse_catalog_model_object` in `runtime/rust/prompty-foundry/src/models.rs`.
 */
export function catalogModelToModelInfo(raw: Record<string, unknown>): ModelInfo {
  return new ModelInfo({
    id: typeof raw["id"] === "string" ? raw["id"] : "",
    ownedBy: typeof raw["owned_by"] === "string" ? raw["owned_by"] : undefined,
    contextWindow: typeof raw["maxContextLength"] === "number" ? raw["maxContextLength"] : undefined,
    additionalProperties: raw,
  });
}

/**
 * Map one raw Foundry deployment into the provider-neutral `ModelInfo` contract.
 *
 * Foundry's data-plane `/deployments?api-version=v1` returns a flat shape
 * (`modelName`, `modelPublisher`, top-level `capabilities`), while the ARM
 * management-plane shape nests these under `properties.model`. Both are
 * supported, matching `parse_deployment_object` in
 * `runtime/rust/prompty-foundry/src/models.rs`.
 */
export function deploymentToModelInfo(raw: Record<string, unknown>): ModelInfo {
  const properties = asRecord(raw["properties"]);
  const model = asRecord(properties?.["model"]);
  const capabilities = asRecord(properties?.["capabilities"]) ?? asRecord(model?.["capabilities"]) ?? asRecord(raw["capabilities"]);

  return new ModelInfo({
    id: typeof raw["name"] === "string" ? raw["name"] : "",
    displayName:
      (typeof raw["modelName"] === "string" ? raw["modelName"] : undefined) ??
      (typeof model?.["name"] === "string" ? (model["name"] as string) : undefined),
    ownedBy:
      (typeof raw["modelPublisher"] === "string" ? raw["modelPublisher"] : undefined) ??
      (typeof model?.["publisher"] === "string" ? (model["publisher"] as string) : undefined) ??
      "azure",
    contextWindow:
      getNumber(capabilities, ["maxContextLength", "contextWindow", "context_length"]) ??
      getNumber(model, ["maxContextLength"]) ??
      getNumber(raw, ["maxContextLength"]),
    inputModalities: getStringArray(capabilities, ["inputModalities", "input_modalities", "supportedInputModalities"]),
    outputModalities: getStringArray(capabilities, ["outputModalities", "output_modalities", "supportedOutputModalities"]),
    additionalProperties: raw,
  });
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

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
    models.push(catalogModelToModelInfo(m as unknown as Record<string, unknown>));
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
  return (data.value ?? []).map((deployment) => deploymentToModelInfo(deployment as unknown as Record<string, unknown>));
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
