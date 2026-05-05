/**
 * Foundry executor — extends OpenAI executor with Azure AI Foundry client resolution.
 *
 * For Chat Completions: builds an OpenAI/v1 client from the Foundry project
 * endpoint with DefaultAzureCredential.
 *
 * The Foundry project endpoint is:
 *   https://<resource>.services.ai.azure.com/api/projects/<project>
 * The OpenAI/v1 endpoint (for inference) is:
 *   https://<resource>.openai.azure.com/openai/v1
 *
 * @module
 */

import OpenAI from "openai";
import { DefaultAzureCredential } from "@azure/identity";
import type { Prompty, Message } from "@prompty/core";
import { FoundryConnection, ReferenceConnection, PromptyStream } from "@prompty/core";
import { getConnection, traceSpan, sanitizeValue } from "@prompty/core";
import { OpenAIExecutor } from "@prompty/openai";
import { buildChatArgs, buildEmbeddingArgs, buildImageArgs, buildResponsesArgs } from "@prompty/openai";

/**
 * Convert a Foundry project endpoint into the OpenAI/v1 base URL.
 * e.g. "https://foo.services.ai.azure.com/api/projects/bar" → "https://foo.openai.azure.com/openai/v1"
 */
function getOpenAIBaseURL(projectEndpoint: string): string {
  const url = new URL(projectEndpoint);
  const servicesSuffix = ".services.ai.azure.com";
  let hostname = url.hostname;

  if (hostname.endsWith(servicesSuffix)) {
    hostname = `${hostname.slice(0, -servicesSuffix.length)}.openai.azure.com`;
  }

  const resourceEndpoint = `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ""}`;
  return `${resourceEndpoint}/openai/v1`;
}

const FOUNDRY_TOKEN_SCOPE = "https://ai.azure.com/.default";

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
            baseURL: conn.endpoint ? getOpenAIBaseURL(conn.endpoint) : undefined,
            deployment: agent.model?.id,
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

    // Build an OpenAI/v1 client from the FoundryConnection project endpoint.
    if (conn instanceof FoundryConnection) {
      if (!conn.endpoint) {
        throw new Error(
          "FoundryConnection requires a non-empty 'endpoint'. " +
          "Set model.connection.endpoint to your Foundry project endpoint.",
        );
      }
      const credential = new DefaultAzureCredential();
      const baseURL = getOpenAIBaseURL(conn.endpoint);

      return new OpenAI({
        baseURL,
        apiKey: "unused",
        fetch: async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): ReturnType<typeof fetch> => {
          const token = await credential.getToken(FOUNDRY_TOKEN_SCOPE);
          if (!token?.token) {
            throw new Error("DefaultAzureCredential did not return an access token.");
          }
          const headers = new Headers(init?.headers);
          headers.set("Authorization", `Bearer ${token.token}`);
          return fetch(url, { ...init, headers });
        },
      }) as OpenAI;
    }

    const kind = conn?.kind ?? "unknown";
    throw new Error(
      `Connection kind '${kind}' is not supported by the Foundry executor. ` +
      "Use 'foundry' (with endpoint + DefaultAzureCredential) or " +
      "'reference' (with registerConnection()) for pre-configured clients.",
    );
  }
}
