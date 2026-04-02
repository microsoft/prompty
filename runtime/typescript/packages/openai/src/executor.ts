/**
 * OpenAI executor — sends messages to OpenAI APIs.
 *
 * Dispatches on `agent.model.apiType`: chat, embedding, image.
 *
 * @module
 */

import OpenAI from "openai";
import type { Prompty } from "@prompty/core";
import { ApiKeyConnection, ReferenceConnection, PromptyStream } from "@prompty/core";
import type { Executor } from "@prompty/core";
import type { Message } from "@prompty/core";
import { getConnection } from "@prompty/core";
import { traceSpan, sanitizeValue } from "@prompty/core";
import { buildChatArgs, buildEmbeddingArgs, buildImageArgs, buildResponsesArgs } from "./wire.js";

export class OpenAIExecutor implements Executor {
  async execute(agent: Prompty, messages: Message[]): Promise<unknown> {
    return traceSpan("OpenAIExecutor", async (emit) => {
      emit("signature", "prompty.openai.executor.OpenAIExecutor.invoke");
      emit("inputs", { data: messages });

      const client = this.resolveClient(agent);
      const clientName = client.constructor?.name ?? "OpenAI";

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
      const result = await this.executeApiCall(client, clientName, agent, messages, apiType);
      emit("result", result);
      return result;
    });
  }

  /** Dispatch to the appropriate API and trace the call. */
  private async executeApiCall(
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
            // Wrap streaming response for tracing — don't emit result yet,
            // PromptyStream will trace on exhaustion
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

  protected resolveClient(agent: Prompty): OpenAI {
    const conn = agent.model?.connection;

    if (conn instanceof ReferenceConnection) {
      return getConnection(conn.name) as OpenAI;
    }

    const kwargs = this.clientKwargs(agent);
    return new OpenAI(kwargs);
  }

  protected clientKwargs(agent: Prompty): Record<string, unknown> {
    const kwargs: Record<string, unknown> = {};
    const conn = agent.model?.connection;

    if (conn instanceof ApiKeyConnection) {
      if (conn.apiKey) kwargs.apiKey = conn.apiKey;
      if (conn.endpoint) kwargs.baseURL = conn.endpoint;
    }

    return kwargs;
  }
}
