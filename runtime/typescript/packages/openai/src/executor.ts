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
    return traceSpan("OpenAIExecutor.execute", async (emit) => {
      const client = this.resolveClient(agent);
      const apiType = agent.model?.apiType ?? "chat";

      emit("api_type", apiType);
      emit("model", agent.model?.id ?? "unknown");

      switch (apiType) {
        case "chat":
        case "agent":
          return this.executeChat(client, agent, messages);
        case "embedding":
          return this.executeEmbedding(client, agent, messages);
        case "image":
          return this.executeImage(client, agent, messages);
        default:
          throw new Error(`Unsupported apiType: ${apiType}`);
      }
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

  private async executeChat(
    client: OpenAI,
    agent: Prompty,
    messages: Message[],
  ): Promise<unknown> {
    const args = buildChatArgs(agent, messages);
    return client.chat.completions.create(args as unknown as Parameters<typeof client.chat.completions.create>[0]);
  }

  private async executeEmbedding(
    client: OpenAI,
    agent: Prompty,
    data: unknown,
  ): Promise<unknown> {
    const args = buildEmbeddingArgs(agent, data);
    return client.embeddings.create(args as unknown as Parameters<typeof client.embeddings.create>[0]);
  }

  private async executeImage(
    client: OpenAI,
    agent: Prompty,
    data: unknown,
  ): Promise<unknown> {
    const args = buildImageArgs(agent, data);
    return client.images.generate(args as unknown as Parameters<typeof client.images.generate>[0]);
  }
}
