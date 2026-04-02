/**
 * Anthropic executor — sends messages to Anthropic Messages API.
 *
 * Dispatches on `agent.model.apiType`: only `chat` is supported
 * (Anthropic has no embedding or image APIs).
 * The agent loop (tool-call iteration) is handled by the pipeline,
 * not the executor.
 *
 * @module
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { Prompty } from "@prompty/core";
import { ApiKeyConnection, ReferenceConnection, PromptyStream } from "@prompty/core";
import type { Executor } from "@prompty/core";
import type { Message } from "@prompty/core";
import { getConnection } from "@prompty/core";
import { traceSpan, sanitizeValue } from "@prompty/core";
import { buildChatArgs } from "./wire.js";

export class AnthropicExecutor implements Executor {
  async execute(agent: Prompty, messages: Message[]): Promise<unknown> {
    return traceSpan("AnthropicExecutor", async (emit) => {
      emit("signature", "prompty.anthropic.executor.AnthropicExecutor.invoke");
      emit("inputs", { data: messages });

      const client = this.resolveClient(agent);
      const clientName = "Anthropic";

      // Trace client construction
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
    client: Anthropic,
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
          callEmit("signature", `${clientName}.messages.create`);
          callEmit("inputs", sanitizeValue("create", args));

          if (isStreaming) {
            const stream = client.messages.stream(
              args as unknown as Parameters<typeof client.messages.stream>[0],
            );
            return new PromptyStream(
              `${clientName}Executor`,
              stream as unknown as AsyncIterable<unknown>,
            );
          }

          const result = await client.messages.create(
            args as unknown as Parameters<typeof client.messages.create>[0],
          );
          callEmit("result", result);
          return result;
        });
      }
      default:
        throw new Error(
          `Unsupported apiType "${apiType}" for Anthropic. ` +
            `Anthropic only supports "chat" (Messages API).`,
        );
    }
  }

  protected resolveClient(agent: Prompty): Anthropic {
    const conn = agent.model?.connection;

    if (conn instanceof ReferenceConnection) {
      return getConnection(conn.name) as Anthropic;
    }

    const kwargs = this.clientKwargs(agent);

    // Lazy import — only needed when actually called
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AnthropicSDK = require("@anthropic-ai/sdk").default;
    return new AnthropicSDK(kwargs);
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
