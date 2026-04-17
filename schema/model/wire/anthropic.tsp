import "prompty-emitter";
import "../model/model.tsp";
import "../model/usage.tsp";

using Prompty;

// ============================================================================
// Anthropic Messages API wire mappings
// https://docs.anthropic.com/en/api/messages
// ============================================================================

// ModelOptions → Anthropic parameter names
// Identity mappings included so strict toWire() knows which fields Anthropic supports
@@knownAs(ModelOptions.temperature, "anthropic", "temperature");
@@knownAs(ModelOptions.maxOutputTokens, "anthropic", "max_tokens");
@@knownAs(ModelOptions.topK, "anthropic", "top_k");
@@knownAs(ModelOptions.topP, "anthropic", "top_p");
@@knownAs(ModelOptions.stopSequences, "anthropic", "stop_sequences");

// TokenUsage → Anthropic usage field names
@@knownAs(TokenUsage.promptTokens, "anthropic", "input_tokens");
@@knownAs(TokenUsage.completionTokens, "anthropic", "output_tokens");
