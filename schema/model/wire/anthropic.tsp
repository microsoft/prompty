import "@typra/emitter";
import "../contracts/models/discovery.tsp";
import "../contracts/models/model.tsp";
import "../contracts/models/usage.tsp";

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
// Identity mappings included so strict toWire() knows which fields Anthropic supports.
//
// NOTE: temperature/topK/topP are DEPRECATED by Anthropic for models released
// after Claude Opus 4.6 (only no-op values accepted; others → 400). They remain
// mapped here because older models still honor them; the executor is responsible
// for dropping unsupported sampling params per target model.
//
// reasoningEffort is intentionally NOT mapped for Anthropic: its reasoning
// control is the nested `thinking` object (`{type, budget_tokens}`), not a flat
// scalar rename, so it cannot be expressed via @@knownAs. The Anthropic executor
// translates reasoningEffort → thinking config when needed.
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
