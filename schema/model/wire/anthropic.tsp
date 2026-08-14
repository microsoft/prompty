import "@typra/emitter";
import "../model/discovery.tsp";
import "../model/model.tsp";
import "../model/usage.tsp";

using Prompty;
using Prompty.Contracts.Models;

// ModelInfo → Anthropic model-list response field names.
@@knownAs(ModelInfo.id, "anthropic", "id");
@@knownAs(ModelInfo.displayName, "anthropic", "display_name");
@@knownAs(ModelInfo.contextWindow, "anthropic", "context_length");
@@knownAs(ModelInfo.inputModalities, "anthropic", "input_modalities");
@@knownAs(ModelInfo.outputModalities, "anthropic", "output_modalities");

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

// InvocationUsage → Anthropic terminal streaming usage field names
@@knownAs(InvocationUsage.inputTokens, "anthropic", "input_tokens");
@@knownAs(InvocationUsage.outputTokens, "anthropic", "output_tokens");
