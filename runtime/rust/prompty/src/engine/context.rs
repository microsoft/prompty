//! Compose runtime-local context sources into immutable model-invocation snapshots.

use std::{collections::HashSet, sync::Arc};

use async_trait::async_trait;
use serde_json::Value;

// Adopt the generated cross-runtime contracts directly instead of maintaining
// engine-local twins. Field layout, variant names, and wire form are identical.
pub use crate::model::{
    ContextCandidate, ContextRequest, DelegatedStateReference,
    InvocationContextDecision as ContextDecision,
    InvocationContextDisposition as ContextDisposition,
    InvocationContextPortability as ContextPortability, InvocationContextState,
    ModelInvocationContextSnapshot,
};

/// Errors raised while assembling context for a model invocation.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum ContextError {
    /// A context source, transform, or packing strategy failed.
    #[error("{stage} '{name}' failed: {source}")]
    Stage {
        stage: &'static str,
        name: String,
        #[source]
        source: Box<ContextError>,
    },

    /// A packing strategy produced an invalid snapshot.
    #[error("invalid context snapshot: {0}")]
    InvalidSnapshot(String),
}

/// Snapshot invariants required for caching, portability, and replay.
///
/// `ModelInvocationContextSnapshot` is the generated cross-runtime contract; the
/// engine adds these same-crate inherent validators to keep the durable-turn
/// invariants co-located with the pipeline that produces them.
impl ModelInvocationContextSnapshot {
    /// Validate invariants required for caching, portability, and replay.
    pub fn validate(&self) -> Result<(), ContextError> {
        if self.stable_prefix_messages < 0
            || self.stable_prefix_messages as usize > self.messages.len()
        {
            return Err(ContextError::InvalidSnapshot(format!(
                "stable prefix contains {} messages but snapshot contains {}",
                self.stable_prefix_messages,
                self.messages.len()
            )));
        }
        if self.context_state.portability == ContextPortability::Portable
            && !self.context_state.delegated_state.is_empty()
        {
            return Err(ContextError::InvalidSnapshot(
                "portable snapshots cannot contain delegated provider state".to_string(),
            ));
        }
        if self.context_state.portability == ContextPortability::Delegated
            && self.context_state.delegated_state.is_empty()
        {
            return Err(ContextError::InvalidSnapshot(
                "delegated snapshots must identify provider-held state".to_string(),
            ));
        }
        Ok(())
    }

    /// Validate snapshot invariants and identity against the invocation request.
    pub fn validate_for(&self, request: &ContextRequest) -> Result<(), ContextError> {
        self.validate()?;
        if self.session_id != request.session_id
            || self.turn_id != request.turn_id
            || self.invocation_id != request.invocation_id
            || self.iteration != request.iteration
        {
            return Err(ContextError::InvalidSnapshot(format!(
                "snapshot identity ({}/{}/{}/{}) does not match request ({}/{}/{}/{})",
                self.session_id,
                self.turn_id,
                self.invocation_id,
                self.iteration,
                request.session_id,
                request.turn_id,
                request.invocation_id,
                request.iteration
            )));
        }
        Ok(())
    }
}

/// Supplies context candidates such as history, recalled memory, files, or host state.
#[async_trait]
pub trait ContextSource: Send + Sync {
    fn name(&self) -> &str;

    async fn load(&self, request: &ContextRequest) -> Result<Vec<ContextCandidate>, ContextError>;
}

/// Filters, redacts, ranks, deduplicates, or enriches context candidates.
#[async_trait]
pub trait ContextTransform: Send + Sync {
    fn name(&self) -> &str;

    async fn apply(
        &self,
        request: &ContextRequest,
        candidates: Vec<ContextCandidate>,
    ) -> Result<Vec<ContextCandidate>, ContextError>;
}

/// Selects and orders candidates under token, cost, and cache-affinity constraints.
#[async_trait]
pub trait ContextPackingStrategy: Send + Sync {
    fn name(&self) -> &str;

    async fn pack(
        &self,
        request: &ContextRequest,
        candidates: Vec<ContextCandidate>,
    ) -> Result<ModelInvocationContextSnapshot, ContextError>;
}

/// Composes context sources, transforms, and a packing strategy.
///
/// Sources and transforms run in registration order so deterministic effect
/// bundles can reproduce candidate and decision ordering.
pub struct ContextPipeline {
    sources: Vec<Arc<dyn ContextSource>>,
    transforms: Vec<Arc<dyn ContextTransform>>,
    packing: Arc<dyn ContextPackingStrategy>,
}

/// Deterministic baseline packer that appends every candidate in source order.
///
/// Production profiles can replace this with token-aware, relevance-aware, or
/// cache-affinity strategies without changing the engine.
#[derive(Debug, Clone, Default)]
pub struct AppendContextPackingStrategy;

#[async_trait]
impl ContextPackingStrategy for AppendContextPackingStrategy {
    fn name(&self) -> &str {
        "append"
    }

    async fn pack(
        &self,
        request: &ContextRequest,
        candidates: Vec<ContextCandidate>,
    ) -> Result<ModelInvocationContextSnapshot, ContextError> {
        let mut messages = request.messages.clone();
        let mut decisions = Vec::with_capacity(candidates.len());
        for (rank, candidate) in candidates.into_iter().enumerate() {
            messages.extend(candidate.messages);
            decisions.push(ContextDecision {
                candidate_id: candidate.id,
                disposition: ContextDisposition::Included,
                reason: "included by append strategy".to_string(),
                rank: Some(rank as i32),
                estimated_tokens: None,
                metadata: candidate.metadata,
            });
        }

        Ok(ModelInvocationContextSnapshot {
            id: format!("context:{}", request.invocation_id),
            session_id: request.session_id.clone(),
            turn_id: request.turn_id.clone(),
            invocation_id: request.invocation_id.clone(),
            iteration: request.iteration,
            messages,
            decisions,
            stable_prefix_messages: request.stable_prefix_messages,
            context_state: InvocationContextState {
                portability: request.context_state.portability,
                delegated_state: request.context_state.delegated_state.clone(),
            },
            metadata: Value::Null,
        })
    }
}

impl ContextPipeline {
    pub fn new(packing: Arc<dyn ContextPackingStrategy>) -> Self {
        Self {
            sources: Vec::new(),
            transforms: Vec::new(),
            packing,
        }
    }

    pub fn with_source(mut self, source: Arc<dyn ContextSource>) -> Self {
        self.sources.push(source);
        self
    }

    pub fn with_transform(mut self, transform: Arc<dyn ContextTransform>) -> Self {
        self.transforms.push(transform);
        self
    }

    /// Assemble and validate a snapshot for one model invocation.
    pub async fn prepare(
        &self,
        request: &ContextRequest,
    ) -> Result<ModelInvocationContextSnapshot, ContextError> {
        let mut candidates = Vec::new();
        for source in &self.sources {
            let mut loaded = source
                .load(request)
                .await
                .map_err(|error| ContextError::Stage {
                    stage: "context source",
                    name: source.name().to_string(),
                    source: Box::new(error),
                })?;
            candidates.append(&mut loaded);
        }
        let mut candidate_ids = HashSet::new();
        for candidate in &candidates {
            if !candidate_ids.insert(candidate.id.as_str()) {
                return Err(ContextError::InvalidSnapshot(format!(
                    "duplicate context candidate id '{}'",
                    candidate.id
                )));
            }
        }

        let mut excluded = Vec::new();
        for transform in &self.transforms {
            let before = candidates.clone();
            candidates = transform
                .apply(request, candidates)
                .await
                .map_err(|error| ContextError::Stage {
                    stage: "context transform",
                    name: transform.name().to_string(),
                    source: Box::new(error),
                })?;
            let retained: HashSet<&str> = candidates
                .iter()
                .map(|candidate| candidate.id.as_str())
                .collect();
            excluded.extend(
                before
                    .into_iter()
                    .filter(|candidate| !retained.contains(candidate.id.as_str()))
                    .map(|candidate| ContextDecision {
                        candidate_id: candidate.id,
                        disposition: ContextDisposition::Excluded,
                        reason: format!("excluded by context transform '{}'", transform.name()),
                        rank: None,
                        estimated_tokens: None,
                        metadata: candidate.metadata,
                    }),
            );
        }

        let packed_candidates = candidates.clone();
        let mut snapshot = self
            .packing
            .pack(request, candidates)
            .await
            .map_err(|error| ContextError::Stage {
                stage: "packing strategy",
                name: self.packing.name().to_string(),
                source: Box::new(error),
            })?;
        let decided: HashSet<String> = snapshot
            .decisions
            .iter()
            .map(|decision| decision.candidate_id.clone())
            .collect();
        excluded.extend(
            packed_candidates
                .into_iter()
                .filter(|candidate| !decided.contains(&candidate.id))
                .map(|candidate| ContextDecision {
                    candidate_id: candidate.id,
                    disposition: ContextDisposition::Excluded,
                    reason: format!(
                        "excluded without an explicit decision by packing strategy '{}'",
                        self.packing.name()
                    ),
                    rank: None,
                    estimated_tokens: None,
                    metadata: candidate.metadata,
                }),
        );
        snapshot.decisions.extend(excluded);
        snapshot.validate_for(request)?;
        Ok(snapshot)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Message;

    struct StaticSource {
        name: &'static str,
        candidates: Vec<ContextCandidate>,
    }

    #[async_trait]
    impl ContextSource for StaticSource {
        fn name(&self) -> &str {
            self.name
        }

        async fn load(
            &self,
            _request: &ContextRequest,
        ) -> Result<Vec<ContextCandidate>, ContextError> {
            Ok(self.candidates.clone())
        }
    }

    struct RemoveCandidate(&'static str);

    #[async_trait]
    impl ContextTransform for RemoveCandidate {
        fn name(&self) -> &str {
            "remove_candidate"
        }

        async fn apply(
            &self,
            _request: &ContextRequest,
            candidates: Vec<ContextCandidate>,
        ) -> Result<Vec<ContextCandidate>, ContextError> {
            Ok(candidates
                .into_iter()
                .filter(|candidate| candidate.id != self.0)
                .collect())
        }
    }

    struct IncludeAll;

    #[async_trait]
    impl ContextPackingStrategy for IncludeAll {
        fn name(&self) -> &str {
            "include_all"
        }

        async fn pack(
            &self,
            request: &ContextRequest,
            candidates: Vec<ContextCandidate>,
        ) -> Result<ModelInvocationContextSnapshot, ContextError> {
            let mut messages = request.messages.clone();
            let mut decisions = Vec::new();
            for (rank, candidate) in candidates.into_iter().enumerate() {
                messages.extend(candidate.messages);
                decisions.push(ContextDecision {
                    candidate_id: candidate.id,
                    disposition: ContextDisposition::Included,
                    reason: "included by test strategy".to_string(),
                    rank: Some(rank as i32),
                    estimated_tokens: None,
                    metadata: Value::Null,
                });
            }
            Ok(ModelInvocationContextSnapshot {
                id: format!("snapshot-{}", request.invocation_id),
                session_id: request.session_id.clone(),
                turn_id: request.turn_id.clone(),
                invocation_id: request.invocation_id.clone(),
                iteration: request.iteration,
                stable_prefix_messages: request.messages.len() as i32,
                messages,
                decisions,
                context_state: InvocationContextState {
                    portability: ContextPortability::Portable,
                    delegated_state: Vec::new(),
                },
                metadata: Value::Null,
            })
        }
    }

    struct DropAll;

    #[async_trait]
    impl ContextPackingStrategy for DropAll {
        fn name(&self) -> &str {
            "drop_all"
        }

        async fn pack(
            &self,
            request: &ContextRequest,
            _candidates: Vec<ContextCandidate>,
        ) -> Result<ModelInvocationContextSnapshot, ContextError> {
            Ok(ModelInvocationContextSnapshot {
                id: format!("snapshot-{}", request.invocation_id),
                session_id: request.session_id.clone(),
                turn_id: request.turn_id.clone(),
                invocation_id: request.invocation_id.clone(),
                iteration: request.iteration,
                stable_prefix_messages: request.messages.len() as i32,
                messages: request.messages.clone(),
                decisions: Vec::new(),
                context_state: InvocationContextState {
                    portability: ContextPortability::Portable,
                    delegated_state: Vec::new(),
                },
                metadata: Value::Null,
            })
        }
    }

    fn candidate(id: &str, text: &str) -> ContextCandidate {
        ContextCandidate {
            id: id.to_string(),
            source: "test".to_string(),
            messages: vec![Message::user(text)],
            metadata: Value::Null,
        }
    }

    fn request() -> ContextRequest {
        ContextRequest {
            session_id: "session-1".to_string(),
            turn_id: "turn-1".to_string(),
            invocation_id: "invocation-1".to_string(),
            iteration: 0,
            messages: vec![Message::system("You are helpful.")],
            stable_prefix_messages: 1,
            context_state: InvocationContextState {
                portability: ContextPortability::Portable,
                delegated_state: Vec::new(),
            },
            inputs: None,
        }
    }

    #[tokio::test]
    async fn composes_sources_and_transforms_in_registration_order() {
        let pipeline = ContextPipeline::new(Arc::new(IncludeAll))
            .with_source(Arc::new(StaticSource {
                name: "history",
                candidates: vec![candidate("history-1", "Earlier message")],
            }))
            .with_source(Arc::new(StaticSource {
                name: "memory",
                candidates: vec![
                    candidate("memory-1", "Relevant preference"),
                    candidate("memory-2", "Irrelevant preference"),
                ],
            }))
            .with_transform(Arc::new(RemoveCandidate("memory-2")));

        let snapshot = pipeline.prepare(&request()).await.unwrap();

        assert_eq!(snapshot.messages.len(), 3);
        assert_eq!(snapshot.decisions.len(), 3);
        assert_eq!(snapshot.decisions[0].candidate_id, "history-1");
        assert_eq!(snapshot.decisions[1].candidate_id, "memory-1");
        assert_eq!(snapshot.decisions[2].candidate_id, "memory-2");
        assert_eq!(
            snapshot.decisions[2].disposition,
            ContextDisposition::Excluded
        );
        assert_eq!(snapshot.stable_prefix_messages, 1);
    }

    #[tokio::test]
    async fn records_candidates_omitted_by_the_packing_strategy() {
        let pipeline =
            ContextPipeline::new(Arc::new(DropAll)).with_source(Arc::new(StaticSource {
                name: "memory",
                candidates: vec![candidate("memory-1", "Not selected")],
            }));

        let snapshot = pipeline.prepare(&request()).await.unwrap();

        assert_eq!(snapshot.decisions.len(), 1);
        assert_eq!(snapshot.decisions[0].candidate_id, "memory-1");
        assert_eq!(
            snapshot.decisions[0].disposition,
            ContextDisposition::Excluded
        );
        assert!(snapshot.decisions[0].reason.contains("drop_all"));
    }

    #[tokio::test]
    async fn rejects_duplicate_candidate_ids_across_sources() {
        let pipeline = ContextPipeline::new(Arc::new(IncludeAll))
            .with_source(Arc::new(StaticSource {
                name: "history",
                candidates: vec![candidate("duplicate", "History")],
            }))
            .with_source(Arc::new(StaticSource {
                name: "memory",
                candidates: vec![candidate("duplicate", "Memory")],
            }));

        let error = pipeline.prepare(&request()).await.unwrap_err();

        assert!(error.to_string().contains("duplicate context candidate id"));
    }

    #[test]
    fn rejects_delegated_state_in_portable_snapshot() {
        let snapshot = ModelInvocationContextSnapshot {
            id: "snapshot-1".to_string(),
            session_id: "session-1".to_string(),
            turn_id: "turn-1".to_string(),
            invocation_id: "invocation-1".to_string(),
            iteration: 0,
            messages: Vec::new(),
            decisions: Vec::new(),
            stable_prefix_messages: 0,
            context_state: InvocationContextState {
                portability: ContextPortability::Portable,
                delegated_state: vec![DelegatedStateReference {
                    provider: "openai".to_string(),
                    kind: "previous_response".to_string(),
                    id: "response-1".to_string(),
                    metadata: Value::Null,
                }],
            },
            metadata: Value::Null,
        };

        assert!(snapshot.validate().is_err());
    }

    #[test]
    fn requires_a_reference_for_delegated_snapshot() {
        let snapshot = ModelInvocationContextSnapshot {
            id: "snapshot-1".to_string(),
            session_id: "session-1".to_string(),
            turn_id: "turn-1".to_string(),
            invocation_id: "invocation-1".to_string(),
            iteration: 0,
            messages: Vec::new(),
            decisions: Vec::new(),
            stable_prefix_messages: 0,
            context_state: InvocationContextState {
                portability: ContextPortability::Delegated,
                delegated_state: Vec::new(),
            },
            metadata: Value::Null,
        };

        assert!(snapshot.validate().is_err());
    }

    #[test]
    fn rejects_a_stable_prefix_larger_than_the_snapshot() {
        let snapshot = ModelInvocationContextSnapshot {
            id: "snapshot-1".to_string(),
            session_id: "session-1".to_string(),
            turn_id: "turn-1".to_string(),
            invocation_id: "invocation-1".to_string(),
            iteration: 0,
            messages: Vec::new(),
            decisions: Vec::new(),
            stable_prefix_messages: 1,
            context_state: InvocationContextState {
                portability: ContextPortability::Portable,
                delegated_state: Vec::new(),
            },
            metadata: Value::Null,
        };

        assert!(snapshot.validate().is_err());
    }

    #[tokio::test]
    async fn rejects_a_snapshot_for_the_wrong_invocation() {
        struct WrongIdentity;

        #[async_trait]
        impl ContextPackingStrategy for WrongIdentity {
            fn name(&self) -> &str {
                "wrong_identity"
            }

            async fn pack(
                &self,
                request: &ContextRequest,
                _candidates: Vec<ContextCandidate>,
            ) -> Result<ModelInvocationContextSnapshot, ContextError> {
                Ok(ModelInvocationContextSnapshot {
                    id: "snapshot-wrong".to_string(),
                    session_id: request.session_id.clone(),
                    turn_id: request.turn_id.clone(),
                    invocation_id: "different-invocation".to_string(),
                    iteration: request.iteration,
                    messages: request.messages.clone(),
                    decisions: Vec::new(),
                    stable_prefix_messages: request.messages.len() as i32,
                    context_state: InvocationContextState {
                        portability: ContextPortability::Portable,
                        delegated_state: Vec::new(),
                    },
                    metadata: Value::Null,
                })
            }
        }

        let pipeline = ContextPipeline::new(Arc::new(WrongIdentity));

        assert!(pipeline.prepare(&request()).await.is_err());
    }
}
