import "@typra/emitter";
import "../../agent.tsp";

using Prompty;
using Prompty.Conformance.Vectors;
namespace Prompty.Operations.Pipeline;

/** The provenance of a rendered output span (Prompty Jinja Subset §7). */
alias RenderSegmentKind = "literal" | "interp";

/**
 * One provenance-tagged span of rendered output (Prompty Jinja Subset §7,
 * spec/jinja-grammar.md). Concatenating every segment's `text` in source order
 * yields the flat string returned by `render`, so `renderSegments` is the
 * provenance-carrying superset of `render`.
 *
 * `literal` spans originate in the template source; `interp` spans originate in
 * an interpolated input value and carry the originating root property `source`.
 * That provenance lets a downstream structural parser distinguish an
 * author-authored role boundary from one forged inside untrusted input — the
 * injection-deterrence contract that replaces in-band sentinel scanning. A span
 * whose `source` property is declared strict is flagged `strict`; a strict span
 * that forges a role boundary is rejected loudly rather than emitted.
 */
model RenderSegment {
  @doc("Whether this span came from the template (literal) or an input value (interp)")
  kind: RenderSegmentKind;

  @doc("The rendered text of this span")
  text: string;

  @doc("For interp spans, the root input property the value came from")
  source?: string;

  @doc("Whether the originating input property is declared strict")
  strict?: boolean;
}

/** Renders a template string with input values to produce the final prompt text. */
interface Renderer {
  @doc("Render the template string with input values")
  @vector(RenderVectors)
  render(agent: Agent, template: string, inputs: Record<unknown>): string;

  @doc("Render the template into a provenance-tagged segment tree")
  @vector(RenderSegmentVectors)
  renderSegments(agent: Agent, template: string, inputs: Record<unknown>): RenderSegment[];
}
