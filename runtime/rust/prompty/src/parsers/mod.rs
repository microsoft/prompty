//! Parser implementations — convert rendered text into `Message` lists.

mod prompty;

pub use prompty::PromptyChatParser;
pub use prompty::parse_chat;
