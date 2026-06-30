import "@typra/emitter";
import "./content.tsp";

namespace Prompty;

/**
 * The role of a message in a conversation.
 */
alias Role = "system" | "user" | "assistant" | "developer" | "tool";

/**
 * A message in a conversation. Messages have a role and a list of content parts
 * representing the different modalities of the message content.
 */
@factory(
  "user",
  #{ role: "user", parts: #[#{ kind: "text", value: "{text}" }] },
  #{ text: "string" }
)
@factory(
  "system",
  #{ role: "system", parts: #[#{ kind: "text", value: "{text}" }] },
  #{ text: "string" }
)
@factory(
  "assistant",
  #{ role: "assistant", parts: #[#{ kind: "text", value: "{text}" }] },
  #{ text: "string" }
)
@method("text", "string", "Concatenate all TextPart values joined by newline")
@method(
  "toTextContent",
  "unknown",
  "Return plain string if all parts are text, else a list of content part dicts for wire serialization"
)
model Message {
  @doc("The role of the message sender")
  @sample(#{ role: "user" })
  role: Role = "user";

  @doc("The content parts of the message")
  @sample(#{ parts: #[#{ kind: "text", value: "Hello!" }] })
  parts: ContentPart[];

  @doc("Optional metadata associated with the message")
  @sample(#{ metadata: #{ source: "user-input" } })
  metadata: Record<unknown> = #{};
}
