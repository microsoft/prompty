import "prompty-emitter";
import "./core.tsp";
import "./message.tsp";
import "./agent.tsp";
import "./tools.tsp";

namespace Prompty;

/**
 * Pipeline stage contracts — the four protocol interfaces that define
 * how Prompty processes a prompt from template to final result.
 *
 * Each protocol is emitted as the language-appropriate interface type:
 *   - TypeScript: `export interface X { ... }`
 *   - Python:     `class X(Protocol): ...`
 *   - Rust:       `pub trait X { ... }`
 *   - C#:         `public interface IX { ... }`
 *   - Go:         `type X interface { ... }`
 */
@@protocol(Renderer);
@@method(Renderer,
  "render",
  "string",
  "Render the template string with input values",
  #{ agent: "Prompty", template: "string", inputs: "Record<unknown>" }
);

/** Renders a template string with input values to produce the final prompt text. */
model Renderer {}

@@protocol(Parser);
@@method(Parser,
  "preRender",
  "unknown?",
  "Pre-process a template before rendering, returning modified template and context",
  #{ template: "string" },
  true,
  true
);
@@method(Parser,
  "parse",
  "Message[]",
  "Parse rendered text into a structured message array",
  #{ agent: "Prompty", rendered: "string", context: "Record<unknown>?" }
);

/** Parses rendered prompt text into an array of structured messages with role markers. */
model Parser {}

@@protocol(Executor);
@@method(Executor,
  "execute",
  "unknown",
  "Call an LLM provider with messages and return the raw response",
  #{ agent: "Prompty", messages: "Message[]" }
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

@@protocol(Processor);
@@method(Processor,
  "process",
  "unknown",
  "Extract a clean result from a raw LLM response",
  #{ agent: "Prompty", response: "unknown" }
);

/** Extracts a clean, typed result from a raw LLM provider response. */
model Processor {}
