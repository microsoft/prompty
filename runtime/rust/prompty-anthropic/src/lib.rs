//! Anthropic provider for Prompty.
//!
//! This crate provides the Anthropic executor and processor implementations,
//! registered under the key `"anthropic"`.
//!
//! Anthropic's Messages API differs from OpenAI in several key ways:
//! - System messages are extracted to a top-level `system` field
//! - Messages always use content block arrays `[{type: "text", text: "..."}]`
//! - Tools use `input_schema` instead of `parameters`
//! - `max_tokens` is required (defaults to 4096)
//! - Auth uses `x-api-key` header (not `Authorization: Bearer`)
//! - Tool results are batched into one user message with `tool_result` blocks
//!
//! # Usage
//!
//! ```rust,no_run
//! prompty_anthropic::register();
//! // Now invoke/turn will use Anthropic for agents with provider="anthropic"
//! ```

pub mod executor;
pub mod processor;
pub mod wire;

pub use executor::AnthropicExecutor;
pub use processor::{process_response, AnthropicProcessor};

/// Register the Anthropic executor and processor in the global registry.
pub fn register() {
    prompty::register_executor("anthropic", AnthropicExecutor);
    prompty::register_processor("anthropic", AnthropicProcessor);
}
