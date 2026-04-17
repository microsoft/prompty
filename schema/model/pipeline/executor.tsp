import "prompty-emitter";
import "../agent/agent.tsp";
import "../conversation/message.tsp";
import "../conversation/tool-invocation.tsp";

namespace Prompty;

@@protocol(Executor);
@@method(Executor,
  "execute",
  "unknown",
  "Call an LLM provider with messages and return the raw response",
  #{ agent: "Prompty", messages: "Message[]" }
);
@@method(Executor,
  "executeStream",
  "unknown",
  "Call an LLM provider and return a streaming response. Returns a language-specific async iterable/stream of raw chunks. Not all providers support streaming; the default implementation should signal lack of support.",
  #{ agent: "Prompty", messages: "Message[]" },
  true
);
@@method(Executor,
  "formatToolMessages",
  "Message[]",
  "Format tool call results into messages for the next iteration",
  #{
    rawResponse: "unknown",
    toolCalls: "ToolCall[]",
    toolResults: "string[]",
    textContent: "string?",
  },
  false,
  true
);

/** Calls an LLM provider with messages and returns the raw provider response. */
model Executor {}
