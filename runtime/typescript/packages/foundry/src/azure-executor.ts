/**
 * Azure OpenAI executor — extends OpenAI executor with Azure-specific client.
 *
 * @module
 */

import OpenAI, { AzureOpenAI } from "openai";
import type { Prompty, Message } from "@prompty/core";
import { ApiKeyConnection, ReferenceConnection } from "@prompty/core";
import { getConnection, traceSpan } from "@prompty/core";
import { OpenAIExecutor } from "@prompty/openai";

export class AzureExecutor extends OpenAIExecutor {
  override async execute(agent: Prompty, messages: Message[]): Promise<unknown> {
    return traceSpan("AzureExecutor", async (emit) => {
      emit("signature", "prompty.azure.executor.AzureExecutor.invoke");
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
