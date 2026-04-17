import "prompty-emitter";
import "../agent/agent.tsp";

namespace Prompty;

@@protocol(Renderer);
@@method(Renderer,
  "render",
  "string",
  "Render the template string with input values",
  #{ agent: "Prompty", template: "string", inputs: "Record<unknown>" }
);

/** Renders a template string with input values to produce the final prompt text. */
model Renderer {}
