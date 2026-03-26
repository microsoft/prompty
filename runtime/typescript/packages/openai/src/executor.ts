/**
 * OpenAI executor — sends messages to OpenAI APIs.
 *
 * Dispatches on `agent.model.apiType`: chat, embedding, image.
 *
 * @module
 */

import OpenAI from "openai";
import type { Prompty } from "@prompty/core";
import { ApiKeyConnection, ReferenceConnection } from "@prompty/core";
import type { Executor } from "@prompty/core";
import type { Message } from "@prompty/core";
import { getConnection } from "@prompty/core";
import { traceSpan, sanitizeValue } from "@prompty/core";
import { buildChatArgs, buildEmbeddingArgs, buildImageArgs } from "./wire.js";

export class OpenAIExecutor implements Executor {
  async execute(agent: Prompty, messages: Message[]): Promise<unknown> {
    return traceSpan("OpenAIExecutor", async (emit) => {
      emit("signature", "prompty.openai.executor.OpenAIExecutor.invoke");
      emit("inputs", { data: messages });

      // Trace client construction
      const client = await traceSpan("OpenAI", async (ctorEmit) => {
        ctorEmit("signature", "OpenAI.ctor");
        const kwargs = this.clientKwargs(agent);
        ctorEmit("inputs", sanitizeValue("ctor", kwargs));
        const c = this.resolveClient(agent);
        ctorEmit("result", c.constructor?.name ?? "OpenAI");
        return c;
      });

      const apiType = agent.model?.apiType ?? "chat";
      const result = await this.executeApiCall(client, agent, messages, apiType);
      emit("result", result);
      return result;
    });
  }

  /** Dispatch to the appropriate API and trace the call. */
  private async executeApiCall(
    client: OpenAI,
    agent: Prompty,
    messages: Message[],
    apiType: string,
  ): Promise<unknown> {
    switch (apiType) {
      case "chat":
      case "agent":
        return this.executeChatTraced(client, agent, messages);
      case "embedding":
        return this.executeEmbeddingTraced(client, agent, messages);
      case "image":
        return this.executeImageTraced(client, agent, messages);
      default:
        throw new Error(`Unsupported apiType: ${apiType}`);
    }
  }

  private async executeChatTraced(client: OpenAI, agent: Prompty, messages: Message[]): Promise<unknown> {
    const args = buildChatArgs(agent, messages);
    return traceSpan("create", async (emit) => {
      emit("signature", `${client.constructor?.name ?? "OpenAI"}.chat.completions.create`);
      emit("inputs", sanitizeValue("create", args));
      const result = await client.chat.completions.create(
        args as unknown as Parameters<typeof client.chat.completions.create>[0],
      );
      emit("result", result);
      return result;
    });
  }

  private async executeEmbeddingTraced(client: OpenAI, agent: Prompty, data: unknown): Promise<unknown> {
    const args = buildEmbeddingArgs(agent, data);
    return traceSpan("create", async (emit) => {
      emit("signature", `${client.constructor?.name ?? "OpenAI"}.embeddings.create`);
      emit("inputs", sanitizeValue("create", args));
      const result = await client.embeddings.create(
        args as unknown as Parameters<typeof client.embeddings.create>[0],
      );
      emit("result", result);
      return result;
    });
  }

  private async executeImageTraced(client: OpenAI, agent: Prompty, data: unknown): Promise<unknown> {
    const args = buildImageArgs(agent, data);
    return traceSpan("generate", async (emit) => {
      emit("signature", `${client.constructor?.name ?? "OpenAI"}.images.generate`);
      emit("inputs", sanitizeValue("generate", args));
      const result = await client.images.generate(
        args as unknown as Parameters<typeof client.images.generate>[0],
      );
      emit("result", result);
      return result;
    });
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
