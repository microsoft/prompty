import "@typra/emitter";
import "./content.tsp";

using Prompty.Conformance.Samples;
namespace Prompty.Contracts.Conversation;

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
model Message {
  @doc("The role of the message sender")
  @sample(MessageRoleSample)
  role: Role = "user";

  @doc("The content parts of the message")
  @sample(MessagePartsSample)
  parts: ContentPart[];

  @doc("Optional metadata associated with the message. Values may be explicit null.")
  @sample(MessageMetadataSample)
  metadata: Record<unknown>;
}
