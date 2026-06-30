import "@typra/emitter";
import "../agent/agent.tsp";

namespace Prompty;

@@protocol(Processor);
@@method(Processor,
  "process",
  "unknown",
  "Extract a clean result from a raw LLM response",
  #{ agent: "Prompty", response: "unknown" }
);
@@method(Processor,
  "processStream",
  "unknown",
  "Process a streaming response into a stream of StreamChunk items. Takes raw chunks from the executor and yields processed text, thinking, tool, or error chunks. Not all providers support streaming; the default implementation should signal lack of support.",
  #{ stream: "unknown" },
  true
);

/** Extracts a clean, typed result from a raw LLM provider response. */
model Processor {}
