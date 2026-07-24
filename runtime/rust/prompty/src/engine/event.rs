//! Ordered semantic events emitted by the canonical turn engine.
//!
//! The event contract is the generated cross-runtime type. The engine consumes it
//! directly rather than maintaining a structurally identical twin, so the durable
//! event stream is the canonical Typra projection (camelCase envelope, with
//! `runId`/`parentRunId`/`delegationDepth` carried natively).

pub use crate::model::{EngineEvent, EngineEventKind};
