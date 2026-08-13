import "@typra/emitter";
import "../agent/agent.tsp";
import "../conversation/message.tsp";
import "../conversation/tool-invocation.tsp";

namespace Prompty;

/** Calls an LLM provider with messages and returns the raw provider response. */
interface Executor {
  @doc("Call an LLM provider with messages and return the raw response")
  execute(agent: Prompty, messages: Message[]): unknown;

  @doc("Call an LLM provider and return a streaming response. Returns a language-specific async iterable/stream of raw chunks. Not all providers support streaming; the default implementation should signal lack of support.")
  @optionalOperation
  executeStream(agent: Prompty, messages: Message[]): unknown;

  @doc("Format tool call results into messages for the next iteration")
  @sync
  formatToolMessages(
    rawResponse: unknown,
    toolCalls: ToolCall[],
    toolResults: string[],
    textContent?: string,
  ): Message[];
}
