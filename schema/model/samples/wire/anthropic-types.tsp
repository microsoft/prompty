// Named sample constants for wire/anthropic-types.tsp.
// Auto-extracted from inline @sample decorators.

using Prompty.Contracts.Core;
namespace Prompty.Conformance.Samples;

const AnthropicTextBlockTextSample = #{ text: "Hello, how can I help?" };

const AnthropicImageSourceMedia_typeSample = #{ media_type: "image/png" };

const AnthropicImageSourceDataSample = #{ data: "iVBORw0KGgo..." };

const wantsIdSample = #{ id: "toolu_01A09q90qw90lq917835lq9" };

const wantsNameSample = #{ name: "get_weather" };

const wantsInputSample = #{ input: #{ city: "Paris" } };

const AnthropicToolResultBlockTool_use_idSample = #{
  tool_use_id: "toolu_01A09q90qw90lq917835lq9",
};

const AnthropicToolResultBlockContentSample = #{
  content: "72°F and sunny in Paris",
};

const AnthropicWireMessageRoleSample = #{ role: "user" };

const AnthropicToolDefinitionNameSample = #{ name: "get_weather" };

const AnthropicToolDefinitionDescriptionSample = #{
  description: "Get the current weather for a city",
};

const AnthropicMessagesRequestSampleSample = #{
  `model`: "claude-sonnet-4-20250514",
};

const AnthropicMessagesRequestMax_tokensSample = #{ max_tokens: 4096 };

const AnthropicMessagesRequestSystemSample = #{
  system: "You are a helpful assistant.",
};

const AnthropicMessagesRequestTemperatureSample = #{ temperature: 0.7 };

const AnthropicMessagesRequestTop_pSample = #{ top_p: 0.9 };

const AnthropicMessagesRequestTop_kSample = #{ top_k: 40 };

const AnthropicMessagesRequestStop_sequencesSample = #{
  stop_sequences: #["\n\nHuman:"],
};

const AnthropicUsageInput_tokensSample = #{ input_tokens: 150 };

const AnthropicUsageOutput_tokensSample = #{ output_tokens: 42 };

const AnthropicMessagesResponseIdSample = #{
  id: "msg_01XFDUDYJgAACzvnptvVoYEL",
};

const AnthropicMessagesResponseSampleSample = #{
  `model`: "claude-sonnet-4-20250514",
};

const AnthropicMessagesResponseStop_reasonSample = #{ stop_reason: "end_turn" };
