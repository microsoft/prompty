/**
 * OpenAI executor — sends messages to OpenAI APIs.
 *
 * Dispatches on `agent.model.apiType`: chat, embedding, image.
 *
 * @module
 */

import OpenAI from "openai";
import type { Prompty } from "@prompty/core";
import { ApiKeyConnection, ReferenceConnection, PromptyStream, Message, text } from "@prompty/core";
import type { Executor } from "@prompty/core";
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

  formatToolMessages(
    rawResponse: unknown,
    toolCalls: { id: string; name: string; arguments: string }[],
    toolResults: string[],
    textContent = "",
  ): Message[] {
    const messages: Message[] = [];

    // Detect Responses API by checking for call_id on tool calls
    const isResponses =
      toolCalls.length > 0 && "call_id" in (toolCalls[0] as Record<string, unknown>);

    if (isResponses) {
      // Responses API: individual function_call items
      for (const tc of toolCalls) {
        messages.push(
          new Message({ role: "assistant", parts: [], metadata: {
            responses_function_call: {
              type: "function_call",
              call_id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
            },
          } }),
        );
      }
      for (let i = 0; i < toolCalls.length; i++) {
        messages.push(
          new Message({ role: "tool", parts: [text(toolResults[i])], metadata: {
            tool_call_id: toolCalls[i].id,
            name: toolCalls[i].name,
          } }),
        );
      }
    } else {
      // OpenAI Chat format: single assistant + individual tool messages
      const rawToolCalls = toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      }));
      messages.push(
        new Message({ role: "assistant", parts: textContent ? [text(textContent)] : [], metadata: {
          tool_calls: rawToolCalls,
        } }),
      );
      for (let i = 0; i < toolCalls.length; i++) {
        messages.push(
          new Message({ role: "tool", parts: [text(toolResults[i])], metadata: {
            tool_call_id: toolCalls[i].id,
            name: toolCalls[i].name,
          } }),
        );
      }
    }

    return messages;
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
    } else if (conn) {
      throw new Error(
        `Connection kind '${conn.kind}' is not supported by the OpenAI executor. ` +
          `Use 'key' for API key auth or 'reference' with registerConnection() for pre-configured clients.`,
      );
    }

    return kwargs;
  }
}
