import "agentschema-emitter";

namespace Prompty;

/**
 * The phase of the pipeline at which a guardrail is evaluated.
 */
alias GuardrailPhase = "input" | "output" | "tool";

/**
 * The result of a guardrail evaluation. Guardrails are safety checks that
 * run at specific phases of the agent loop and can allow, deny, or rewrite
 * content.
 */
@factory("allow", #{ allowed: true })
@factory("deny", #{ allowed: false }, #{ reason: "string" })
@factory("rewrite", #{ allowed: true }, #{ rewrite: "unknown" })
model GuardrailResult {
  @doc("Whether the content passed the guardrail check")
  @sample(#{ allowed: true })
  allowed: boolean;

  @doc("Explanation of why the content was allowed or denied")
  @sample(#{ reason: "Content is safe" })
  reason?: string;

  @doc("Optional rewritten content to replace the original")
  rewrite?: unknown;
}
