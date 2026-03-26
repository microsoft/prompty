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
import { traceSpan } from "@prompty/core";
import { buildChatArgs, buildEmbeddingArgs, buildImageArgs } from "./wire.js";

export class OpenAIExecutor implements Executor {
  async execute(agent: Prompty, messages: Message[]): Promise<unknown> {
    return traceSpan("OpenAIExecutor", async (emit) => {
      emit("signature", "prompty.openai.executor.OpenAIExecutor.invoke");
      const client = this.resolveClient(agent);
      const apiType = agent.model?.apiType ?? "chat";

      emit("inputs", { data: messages });

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

  protected async executeChat(
    client: OpenAI,
    agent: Prompty,
    messages: Message[],
  ): Promise<unknown> {
    const args = buildChatArgs(agent, messages);
    return client.chat.completions.create(args as unknown as Parameters<typeof client.chat.completions.create>[0]);
  }

  protected async executeEmbedding(
    client: OpenAI,
    agent: Prompty,
    data: unknown,
  ): Promise<unknown> {
    const args = buildEmbeddingArgs(agent, data);
    return client.embeddings.create(args as unknown as Parameters<typeof client.embeddings.create>[0]);
  }

  protected async executeImage(
    client: OpenAI,
    agent: Prompty,
    data: unknown,
  ): Promise<unknown> {
    const args = buildImageArgs(agent, data);
    return client.images.generate(args as unknown as Parameters<typeof client.images.generate>[0]);
  }
}
