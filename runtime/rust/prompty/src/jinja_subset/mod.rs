//! Prompty Jinja Subset engine (spec/jinja-grammar.md) — an owned tokenizer,
//! recursive-descent parser, and evaluator that produces a provenance-tagged
//! segment tree (§7).
//!
//! Ported from the C# and Python reference engines
//! (`runtime/csharp/Prompty.Core/JinjaSubset/*.cs`,
//! `runtime/python/prompty/prompty/jinja_subset/*.py`). `render_segments` is the
//! provenance-carrying superset of a flat render: concatenating each segment's
//! `text` reproduces the flat string, while the per-span `kind`/`source`/`strict`
//! tags carry literal-vs-interpolated provenance. A `strict` interpolation whose
//! rendered text forges a role boundary is rejected loudly ([`RenderError::Strict`])
//! rather than emitted (§8.4).
//!
//! Value semantics run over [`serde_json::Value`]; a missing lookup collapses to
//! `Value::Null` (behaviorally identical to `undefined` under §5). Object
//! iteration order follows `serde_json::Map` (this crate builds `serde_json`
//! without `preserve_order`, so maps iterate in sorted-key order); none of the
//! bound conformance vectors exercise map iteration.

mod evaluator;
mod parser;
mod tokenizer;

pub use evaluator::{Segment, render, render_segments};

/// A failure raised while tokenizing, parsing, or evaluating a template.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RenderError {
    /// The template could not be tokenized or parsed under the subset grammar
    /// (spec/jinja-grammar.md §2–§4).
    Syntax(String),
    /// A `strict` input value violated a structural invariant — notably an
    /// interpolated strict property forging a role boundary (§8.4). Fail-closed.
    Strict(String),
}

impl std::fmt::Display for RenderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RenderError::Syntax(m) => write!(f, "template syntax error: {m}"),
            RenderError::Strict(m) => write!(f, "strict violation: {m}"),
        }
    }
}

impl std::error::Error for RenderError {}
