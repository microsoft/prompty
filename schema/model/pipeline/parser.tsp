import "@typra/emitter";
import "../agent/agent.tsp";
import "../conversation/message.tsp";

namespace Prompty;

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
