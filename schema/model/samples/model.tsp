// Named sample constants for the model domain (model/model.tsp).
//
// Each constant is keyed by the target property name and referenced from the
// property's `@sample(...)` decorator. Kept in `namespace Prompty` so model
// files can reference the constants without qualification; can be relocated to
// `Prompty.Conformance.Samples` once the namespace taxonomy is finalized.

namespace Prompty;

// ModelOptions
const ModelOptionsFrequencyPenaltySample = #{ frequencyPenalty: 0.5 };
const ModelOptionsMaxOutputTokensSample = #{ maxOutputTokens: 2048 };
const ModelOptionsPresencePenaltySample = #{ presencePenalty: 0.3 };
const ModelOptionsSeedSample = #{ seed: 42 };
const ModelOptionsTemperatureSample = #{ temperature: 0.7 };
const ModelOptionsTopKSample = #{ topK: 40 };
const ModelOptionsTopPSample = #{ topP: 0.9 };
const ModelOptionsStopSequencesSample = #{ stopSequences: #["\n", "###"] };
const ModelOptionsAllowMultipleToolCallsSample = #{
  allowMultipleToolCalls: true,
};
const ModelOptionsAdditionalPropertiesSample = #{
  additionalProperties: #{
    customProperty: "value",
    anotherProperty: "anotherValue",
  },
};

// Model
const ModelIdSample = #{ id: "gpt-35-turbo" };
const ModelProviderSample = #{ provider: "foundry" };
const ModelApiTypeSample = #{ apiType: "chat" };
const ModelConnectionSample = #{
  connection: #{
    kind: "key",
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/",
    key: "{your-api-key}",
  },
};
const ModelOptionsSample = #{
  options: #{ type: "chat", temperature: 0.7, maxOutputTokens: 1000 },
};
