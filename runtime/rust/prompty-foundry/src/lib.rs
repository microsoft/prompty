//! Azure OpenAI / Foundry provider for Prompty.
//!
//! This crate provides Azure OpenAI and Foundry executor and processor
//! implementations. It reuses the OpenAI wire format from `prompty-openai`
//! and adds Azure-specific URL construction and authentication.
//!
//! Registered under keys `"foundry"` and `"azure"` (legacy alias).
//!
//! # Usage
//!
//! ```rust,no_run
//! prompty_foundry::register();
//! // Now invoke/turn will use Azure OpenAI for agents with provider="foundry" or "azure"
//! ```

pub mod arm_discovery;
pub mod executor;
pub mod models;
pub mod oauth;
pub mod processor;

pub use arm_discovery::{AiResource, FoundryProject, Subscription};
pub use executor::FoundryExecutor;
pub use models::{list_models, list_models_async};
pub use oauth::{AuthCodeFlowInit, DeviceCodeResponse, TokenResponse};
pub use processor::FoundryProcessor;

/// Register the Foundry executor and processor in the global registry.
///
/// Registers under both `"foundry"` (preferred) and `"azure"` (legacy alias).
pub fn register() {
    prompty::register_executor("foundry", FoundryExecutor);
    prompty::register_processor("foundry", FoundryProcessor);
    prompty::register_executor("azure", FoundryExecutor);
    prompty::register_processor("azure", FoundryProcessor);
}
