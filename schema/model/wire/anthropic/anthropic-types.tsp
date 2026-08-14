import "@typra/emitter";

using Prompty.Conformance.Samples;
using Prompty.Contracts.Tooling;
namespace Prompty.Wire.Anthropic;

/**
 * A text content block in Anthropic's array-of-blocks message format.
 */
model AnthropicTextBlock {
  @doc("The content block type")
  type: "text";

  @doc("The text content")
  @sample(AnthropicTextBlockTextSample)
  text: string;
}

/**
 * An image content block using base64-encoded data.
 * Anthropic requires images as base64 with an explicit media type.
 */
model AnthropicImageBlock {
  @doc("The content block type")
  type: "image";

  @doc("The image source (base64-encoded)")
  source: AnthropicImageSource;
}

/**
 * Source descriptor for an Anthropic base64 image.
 */
model AnthropicImageSource {
  @doc("The encoding type (always 'base64' for inline images)")
  type: "base64";

  @doc("The MIME type of the image (e.g., 'image/png', 'image/jpeg')")
  @sample(AnthropicImageSourceMedia_typeSample)
  media_type: string;

  @doc("The base64-encoded image data")
  @sample(AnthropicImageSourceDataSample)
  data: string;
}

/**
 * A tool use content block returned in an assistant message when
 * the model wants to invoke a tool.
 */
model AnthropicToolUseBlock {
  @doc("The content block type")
  type: "tool_use";

  @doc("Unique identifier for this tool invocation")
  @sample(wantsIdSample)
  id: string;

  @doc("The name of the tool to invoke")
  @sample(wantsNameSample)
  name: string;

  @doc("The JSON arguments for the tool call")
  @sample(wantsInputSample)
  input: Record<unknown>;
}

/**
 * A tool result content block sent back to the API with the tool's output.
 */
model AnthropicToolResultBlock {
  @doc("The content block type")
  type: "tool_result";

  @doc("The tool_use id this result corresponds to")
  @sample(AnthropicToolResultBlockTool_use_idSample)
  tool_use_id: string;

  @doc("The tool's output content")
  @sample(AnthropicToolResultBlockContentSample)
  content: string;
}

/**
 * Union of all Anthropic content block types.
 */
union AnthropicContentBlock {
  text: AnthropicTextBlock,
  image: AnthropicImageBlock,
  toolUse: AnthropicToolUseBlock,
  toolResult: AnthropicToolResultBlock,
}

/**
 * A single message in the Anthropic Messages API wire format.
 * Anthropic always uses the array-of-blocks form for content,
 * even when there is only one text block (§7.5).
 */
model AnthropicWireMessage {
  @doc("The message role ('user' or 'assistant')")
  @sample(AnthropicWireMessageRoleSample)
  role: string;

  @doc("Array of typed content blocks (AnthropicTextBlock | AnthropicImageBlock | AnthropicToolUseBlock | AnthropicToolResultBlock)")
  content: unknown[];
}

/**
 * A tool definition in Anthropic's format. Unlike OpenAI which wraps
 * tools in `{type: "function", function: {...}}`, Anthropic uses a
 * flat structure with `input_schema` (§7.5).
 */
model AnthropicToolDefinition {
  @doc("The tool name")
  @sample(AnthropicToolDefinitionNameSample)
  name: string;

  @doc("A description of what the tool does")
  @sample(AnthropicToolDefinitionDescriptionSample)
  description?: string;

  @doc("JSON Schema describing the tool's input parameters")
  input_schema: Record<unknown>;
}

/**
 * The full request body for the Anthropic Messages API (§7.5).
 */
model AnthropicMessagesRequest {
  @doc("The model identifier")
  @sample(AnthropicMessagesRequestSampleSample)
  `model`: string;

  @doc("The non-system messages to send")
  messages: AnthropicWireMessage[];

  @doc("Maximum number of tokens to generate (required by Anthropic)")
  @sample(AnthropicMessagesRequestMax_tokensSample)
  max_tokens: int32;

  @doc("System prompt text (extracted from system-role messages)")
  @sample(AnthropicMessagesRequestSystemSample)
  system?: string;

  @doc("Sampling temperature")
  @sample(AnthropicMessagesRequestTemperatureSample)
  temperature?: float32;

  @doc("Top-P sampling value")
  @sample(AnthropicMessagesRequestTop_pSample)
  top_p?: float32;

  @doc("Top-K sampling value")
  @sample(AnthropicMessagesRequestTop_kSample)
  top_k?: int32;

  @doc("Stop sequences to end generation")
  @sample(AnthropicMessagesRequestStop_sequencesSample)
  stop_sequences?: string[];

  @doc("Tool definitions available to the model")
  tools?: AnthropicToolDefinition[];
}

/**
 * Usage statistics returned in an Anthropic Messages API response.
 */
model AnthropicUsage {
  @doc("Number of input tokens consumed")
  @sample(AnthropicUsageInput_tokensSample)
  input_tokens: int32;

  @doc("Number of output tokens generated")
  @sample(AnthropicUsageOutput_tokensSample)
  output_tokens: int32;
}

/**
 * The response body from the Anthropic Messages API.
 */
model AnthropicMessagesResponse {
  @doc("Unique response identifier")
  @sample(AnthropicMessagesResponseIdSample)
  id: string;

  @doc("Object type (always 'message')")
  type: "message";

  @doc("The role of the response (always 'assistant')")
  role: "assistant";

  @doc("Array of content blocks in the response (AnthropicTextBlock | AnthropicToolUseBlock)")
  content: unknown[];

  @doc("The model that generated the response")
  @sample(AnthropicMessagesResponseSampleSample)
  `model`: string;

  @doc("The reason generation stopped ('end_turn', 'max_tokens', 'stop_sequence', 'tool_use')")
  @sample(AnthropicMessagesResponseStop_reasonSample)
  stop_reason: string;

  @doc("Token usage statistics")
  usage: AnthropicUsage;
}
