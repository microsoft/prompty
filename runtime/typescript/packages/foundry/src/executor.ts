/**
 * Foundry executor — extends OpenAI executor with Azure AI Foundry client resolution.
 *
 * For Chat Completions: builds an AzureOpenAI client from the Foundry resource
 * endpoint (derived from the project endpoint) with DefaultAzureCredential.
 *
 * The Foundry project endpoint is:
 *   https://<resource>.services.ai.azure.com/api/projects/<project>
 * The AzureOpenAI endpoint (for Chat Completions) is:
 *   https://<resource>.services.ai.azure.com
 *
 * @module
 */

import type OpenAI from "openai";
import type { Prompty, Message } from "@prompty/core";
import { FoundryConnection, ReferenceConnection } from "@prompty/core";
import { getConnection, traceSpan } from "@prompty/core";
import { OpenAIExecutor } from "@prompty/openai";

/**
 * Extract the resource base endpoint from a Foundry project endpoint.
 * e.g. "https://foo.services.ai.azure.com/api/projects/bar" → "https://foo.services.ai.azure.com"
 */
function getResourceEndpoint(projectEndpoint: string): string {
  const url = new URL(projectEndpoint);
  return `${url.protocol}//${url.host}`;
}

export class FoundryExecutor extends OpenAIExecutor {
  override async execute(agent: Prompty, messages: Message[]): Promise<unknown> {
    return traceSpan("FoundryExecutor", async (emit) => {
      emit("signature", "prompty.foundry.executor.FoundryExecutor.invoke");
      emit("inputs", { data: messages });
      const client = this.resolveClient(agent);
      const apiType = agent.model?.apiType ?? "chat";

      let result: unknown;
      switch (apiType) {
        case "chat":
        case "agent":
          result = await this.executeChat(client, agent, messages);
          break;
        case "embedding":
          result = await this.executeEmbedding(client, agent, messages);
          break;
        case "image":
          result = await this.executeImage(client, agent, messages);
          break;
        default:
          throw new Error(`Unsupported apiType: ${apiType}`);
      }
      emit("result", result);
      return result;
    });
  }

  protected override resolveClient(agent: Prompty): OpenAI {
    const conn = agent.model?.connection;

    // Pre-registered client by name
    if (conn instanceof ReferenceConnection) {
      return getConnection(conn.name) as OpenAI;
    }

    // Build an AzureOpenAI client from the FoundryConnection endpoint
    if (conn instanceof FoundryConnection && conn.endpoint) {
      const { AzureOpenAI } = require("openai");
      const { DefaultAzureCredential, getBearerTokenProvider } = require("@azure/identity");

      const credential = new DefaultAzureCredential();
      const scope = "https://cognitiveservices.azure.com/.default";
      const azureADTokenProvider = getBearerTokenProvider(credential, scope);
      const resourceEndpoint = getResourceEndpoint(conn.endpoint);

      return new AzureOpenAI({
        endpoint: resourceEndpoint,
        azureADTokenProvider,
        deployment: agent.model?.id,
        apiVersion: "2025-04-01-preview",
      }) as OpenAI;
    }

    throw new Error(
      "Foundry executor requires a FoundryConnection (with endpoint) " +
      "or a ReferenceConnection (with a pre-registered client). " +
      "Set model.connection.kind to 'foundry' with an endpoint, " +
      "or register a client with registerConnection().",
    );
  }
}
