import "prompty-emitter";
import "../model.tsp";
import "../usage.tsp";

using Prompty;

// ============================================================================
// OpenAI Chat Completions API wire mappings
// https://platform.openai.com/docs/api-reference/chat/create
// ============================================================================

// ModelOptions → OpenAI parameter names
@@knownAs(ModelOptions.maxOutputTokens, "openai", "max_completion_tokens");
@@knownAs(ModelOptions.frequencyPenalty, "openai", "frequency_penalty");
@@knownAs(ModelOptions.presencePenalty, "openai", "presence_penalty");
@@knownAs(ModelOptions.topP, "openai", "top_p");
@@knownAs(ModelOptions.topK, "openai", "top_k");
@@knownAs(ModelOptions.stopSequences, "openai", "stop");
@@knownAs(ModelOptions.allowMultipleToolCalls, "openai", "parallel_tool_calls");

// TokenUsage → OpenAI usage field names
@@knownAs(TokenUsage.promptTokens, "openai", "prompt_tokens");
@@knownAs(TokenUsage.completionTokens, "openai", "completion_tokens");
@@knownAs(TokenUsage.totalTokens, "openai", "total_tokens");
