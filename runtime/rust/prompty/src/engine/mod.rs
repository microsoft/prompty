//! Rust-first execution engine contracts incubated against real application workloads.

pub mod cancellation;
pub mod context;
pub mod event;
pub mod ports;
pub mod turn;

pub use cancellation::CancellationToken;
pub use context::{
    AppendContextPackingStrategy, ContextCandidate, ContextDecision, ContextDisposition,
    ContextError, ContextPackingStrategy, ContextPipeline, ContextPortability, ContextRequest,
    ContextSource, ContextTransform, DelegatedStateReference, InvocationContextState,
    ModelInvocationContextSnapshot,
};
pub use event::{EngineEvent, EngineEventKind};
pub use ports::{
    AllowAllPermissions, Clock, ConversationPort, DefaultConversationPort, DurabilityPort,
    EngineCheckpoint, EnginePermissionDecision, EngineToolRequest, EngineToolResult,
    FinalOutputPolicyRequest, FinalOutputPolicyResult, HostPolicyError, HostPolicyPort,
    HostPolicyRequest, HostPolicyResult, IdGenerator, ModelInvocationRequest,
    ModelInvocationResponse, ModelPort, ModelReconciliationState, ModelStreamChunk,
    ModelStreamPort, ModelToolOutcome, ModelToolRequest, ModelToolResult, NoopDurabilityPort,
    NoopHostPolicyPort, NoopModelStreamPort, NoopPostCommitPort, NoopRetryPolicyPort,
    PermissionPort, PortError, PostCommitPort, ResumeContext, RetryPolicyError, RetryPolicyPort,
    RetryPolicyRequest, ToolOutcome, ToolPort,
};
pub use turn::{
    EngineTurnStatus, TurnCommit, TurnEngine, TurnEngineEffects, TurnEngineError,
    TurnEngineRequest, TurnEngineResult, TurnStatus,
};
