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
import { FoundryConnection, ReferenceConnection, PromptyStream } from "@prompty/core";
import { getConnection, traceSpan, sanitizeValue } from "@prompty/core";
import { OpenAIExecutor } from "@prompty/openai";
import { buildChatArgs, buildEmbeddingArgs, buildImageArgs, buildResponsesArgs } from "@prompty/openai";

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
      const clientName = client.constructor?.name ?? "OpenAI";

      // Trace what client we resolved and how
      await traceSpan(clientName, async (ctorEmit) => {
        ctorEmit("signature", `${clientName}.ctor`);
        const conn = agent.model?.connection;
        if (conn instanceof ReferenceConnection) {
          ctorEmit("inputs", { source: "reference", name: conn.name });
        } else if (conn instanceof FoundryConnection) {
          ctorEmit("inputs", sanitizeValue("ctor", {
            endpoint: conn.endpoint ? getResourceEndpoint(conn.endpoint) : undefined,
            deployment: agent.model?.id,
            apiVersion: "2025-04-01-preview",
            auth: "DefaultAzureCredential",
          }));
        }
        ctorEmit("result", clientName);
      });

      const apiType = agent.model?.apiType ?? "chat";
      const result = await this.dispatchApiCall(client, clientName, agent, messages, apiType);
      emit("result", result);
      return result;
    });
  }

  private async dispatchApiCall(
    client: OpenAI,
    clientName: string,
    agent: Prompty,
    messages: Message[],
    apiType: string,
  ): Promise<unknown> {
    switch (apiType) {
      case "chat": {
        const args = buildChatArgs(agent, messages);
        const isStreaming = !!args.stream;
        return traceSpan("create", async (callEmit) => {
          callEmit("signature", `${clientName}.chat.completions.create`);
          callEmit("inputs", sanitizeValue("create", args));
          const result = await client.chat.completions.create(
            args as unknown as Parameters<typeof client.chat.completions.create>[0],
          );
          if (isStreaming) {
            return new PromptyStream(`${clientName}Executor`, result as unknown as AsyncIterable<unknown>);
          }
          callEmit("result", result);
          return result;
        });
      }
      case "embedding": {
        const args = buildEmbeddingArgs(agent, messages);
        return traceSpan("create", async (callEmit) => {
          callEmit("signature", `${clientName}.embeddings.create`);
          callEmit("inputs", sanitizeValue("create", args));
          const result = await client.embeddings.create(
            args as unknown as Parameters<typeof client.embeddings.create>[0],
          );
          callEmit("result", result);
          return result;
        });
      }
      case "image": {
        const args = buildImageArgs(agent, messages);
        return traceSpan("generate", async (callEmit) => {
          callEmit("signature", `${clientName}.images.generate`);
          callEmit("inputs", sanitizeValue("generate", args));
          const result = await client.images.generate(
            args as unknown as Parameters<typeof client.images.generate>[0],
          );
          callEmit("result", result);
          return result;
        });
      }
      case "responses": {
        const args = buildResponsesArgs(agent, messages);
        const isStreaming = !!args.stream;
        return traceSpan("create", async (callEmit) => {
          callEmit("signature", `${clientName}.responses.create`);
          callEmit("inputs", sanitizeValue("create", args));
          const result = await client.responses.create(
            args as unknown as Parameters<typeof client.responses.create>[0],
          );
          if (isStreaming) {
            return new PromptyStream(`${clientName}Executor`, result as unknown as AsyncIterable<unknown>);
          }
          callEmit("result", result);
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
