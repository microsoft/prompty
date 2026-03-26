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
import { getConnection, traceSpan, sanitizeValue } from "@prompty/core";
import { OpenAIExecutor } from "@prompty/openai";
import { buildChatArgs, buildEmbeddingArgs, buildImageArgs } from "@prompty/openai";

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

      // Trace client construction
      const client = await traceSpan("AzureOpenAI", async (ctorEmit) => {
        ctorEmit("signature", "AzureOpenAI.ctor");
        const kwargs = this.clientKwargs(agent);
        ctorEmit("inputs", sanitizeValue("ctor", kwargs));
        const c = this.resolveClient(agent);
        ctorEmit("result", c.constructor?.name ?? "AzureOpenAI");
        return c;
      });

      const apiType = agent.model?.apiType ?? "chat";
      const result = await this.dispatchApiCall(client, agent, messages, apiType);
      emit("result", result);
      return result;
    });
  }

  private async dispatchApiCall(
    client: OpenAI,
    agent: Prompty,
    messages: Message[],
    apiType: string,
  ): Promise<unknown> {
    switch (apiType) {
      case "chat":
      case "agent": {
        const args = buildChatArgs(agent, messages);
        return traceSpan("create", async (emit) => {
          emit("signature", "AzureOpenAI.chat.completions.create");
          emit("inputs", sanitizeValue("create", args));
          const result = await client.chat.completions.create(
            args as unknown as Parameters<typeof client.chat.completions.create>[0],
          );
          emit("result", result);
          return result;
        });
      }
      case "embedding": {
        const args = buildEmbeddingArgs(agent, messages);
        return traceSpan("create", async (emit) => {
          emit("signature", "AzureOpenAI.embeddings.create");
          emit("inputs", sanitizeValue("create", args));
          const result = await client.embeddings.create(
            args as unknown as Parameters<typeof client.embeddings.create>[0],
          );
          emit("result", result);
          return result;
        });
      }
      case "image": {
        const args = buildImageArgs(agent, messages);
        return traceSpan("generate", async (emit) => {
          emit("signature", "AzureOpenAI.images.generate");
          emit("inputs", sanitizeValue("generate", args));
          const result = await client.images.generate(
            args as unknown as Parameters<typeof client.images.generate>[0],
          );
          emit("result", result);
          return result;
        });
      }
      default:
        throw new Error(`Unsupported apiType: ${apiType}`);
    }
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
