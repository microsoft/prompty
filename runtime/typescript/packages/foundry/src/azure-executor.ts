/**
 * Azure OpenAI executor — extends OpenAI executor with Azure-specific client.
 *
 * @module
 */

import OpenAI, { AzureOpenAI } from "openai";
import type { Prompty, Message } from "@prompty/core";
import { ApiKeyConnection, ReferenceConnection, PromptyStream } from "@prompty/core";
import { getConnection, traceSpan, sanitizeValue } from "@prompty/core";
import { OpenAIExecutor } from "@prompty/openai";
import { buildChatArgs, buildEmbeddingArgs, buildImageArgs, buildResponsesArgs } from "@prompty/openai";

export class AzureExecutor extends OpenAIExecutor {
  override async execute(agent: Prompty, messages: Message[]): Promise<unknown> {
    return traceSpan("AzureExecutor", async (emit) => {
      emit("signature", "prompty.azure.executor.AzureExecutor.invoke");
      emit("inputs", { data: messages });

      const client = this.resolveClient(agent);
      const clientName = client.constructor?.name ?? "AzureOpenAI";

      // Trace what client we resolved and how
      await traceSpan(clientName, async (ctorEmit) => {
        ctorEmit("signature", `${clientName}.ctor`);
        const conn = agent.model?.connection;
        if (conn instanceof ReferenceConnection) {
          ctorEmit("inputs", { source: "reference", name: conn.name });
        } else {
          ctorEmit("inputs", sanitizeValue("ctor", this.clientKwargs(agent)));
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

    if (conn instanceof ReferenceConnection) {
      return getConnection(conn.name) as OpenAI;
    }

    const kwargs = this.clientKwargs(agent);
    return new AzureOpenAI(kwargs as ConstructorParameters<typeof AzureOpenAI>[0]);
  }

  protected override clientKwargs(agent: Prompty): Record<string, unknown> {
    const kwargs: Record<string, unknown> = {};
    const conn = agent.model?.connection;

    if (conn instanceof ApiKeyConnection) {
      if (conn.apiKey) kwargs.apiKey = conn.apiKey;
      if (conn.endpoint) kwargs.endpoint = conn.endpoint;
    }

    // Azure requires deployment = model id
    kwargs.deployment = agent.model?.id;

    return kwargs;
  }
}
