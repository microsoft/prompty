//! OpenAI provider for Prompty.
//!
//! This crate provides the OpenAI executor and processor implementations,
//! registered under the key `"openai"`.
//!
//! # Usage
//!
//! ```rust,no_run
//! prompty_openai::register();
//! // Now invoke/turn will use OpenAI for agents with provider="openai"
//! ```

pub mod executor;
pub mod models;
pub mod processor;
pub mod wire;

pub use executor::OpenAIExecutor;
pub use models::{list_models, list_models_async};
pub use processor::{
    OpenAIProcessor, extract_tool_calls, process_invocation_response,
    process_invocation_response_with_context, process_response,
};
pub use wire::{
    SchemaError, build_chat_args, build_embedding_args, build_image_args, build_responses_args,
    format_tool_messages, message_to_wire, tools_to_wire,
};

/// Register the OpenAI executor and processor in the global registry.
pub fn register() {
    prompty::register_executor("openai", OpenAIExecutor);
    prompty::register_processor("openai", OpenAIProcessor);
}
