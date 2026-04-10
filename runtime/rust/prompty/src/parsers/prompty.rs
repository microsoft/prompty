//! PromptyChatParser — splits rendered text at role markers into `Message` objects.
//!
//! Role markers are lines matching:
//! ```text
//! system:
//! user:
//! assistant:
//! developer:
//! ```
//! with optional leading whitespace/`#` and optional attribute blocks like `[key=value]`.
//!
//! Registered under key `"prompty"`.

use std::sync::LazyLock;

use async_trait::async_trait;
use regex::Regex;

use crate::interfaces::{InvokerError, Parser};
use crate::model::Prompty;
use crate::types::{ContentPart, Message, Role, TextPart};

/// Boundary regex per spec §6.5: role marker on its own line.
static BOUNDARY_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)^\s*#?\s*(system|user|assistant|developer)(\[(\w+\s*=\s*"?[^"]*"?\s*,?\s*)+\])?\s*:\s*$"#)
        .expect("boundary regex is valid")
});

/// The Prompty chat parser — splits role-marker-delimited text into messages.
pub struct PromptyChatParser;

#[async_trait]
impl Parser for PromptyChatParser {
    async fn parse(
        &self,
        _agent: &Prompty,
        rendered: &str,
        _context: Option<&serde_json::Value>,
    ) -> Result<Vec<Message>, InvokerError> {
        Ok(parse_chat(rendered))
    }
}

/// Parse rendered text into a list of messages.
pub fn parse_chat(text: &str) -> Vec<Message> {
    let mut messages: Vec<Message> = Vec::new();
    let mut current_role = Role::System; // default if no marker at start
    let mut content_lines: Vec<&str> = Vec::new();
    let mut has_role_marker = false;

    for line in text.split('\n') {
        if let Some(caps) = BOUNDARY_RE.captures(line.trim()) {
            // Flush accumulated content as a message
            if !content_lines.is_empty() || has_role_marker {
                let content = join_and_trim(&content_lines);
                messages.push(make_message(current_role, content));
                content_lines.clear();
            }

            // Start new role
            let role_str = caps.get(1).unwrap().as_str();
            current_role = Role::from_str_opt(role_str).unwrap_or(Role::System);
            has_role_marker = true;
        } else {
            content_lines.push(line);
        }
    }

    // Flush remaining content
    if !content_lines.is_empty() || has_role_marker {
        let content = join_and_trim(&content_lines);
        messages.push(make_message(current_role, content));
    }

    messages
}

/// Join lines and strip leading/trailing newlines (but preserve spaces).
fn join_and_trim(lines: &[&str]) -> String {
    let joined = lines.join("\n");
    joined.trim_matches('\n').to_string()
}

/// Create a `Message` with a single text part.
fn make_message(role: Role, content: String) -> Message {
    Message {
        role,
        parts: vec![ContentPart::Text(TextPart { value: content })],
        metadata: serde_json::Map::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_single_system() {
        let msgs = parse_chat("system:\nYou are helpful.");
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].role, Role::System);
        assert_eq!(msgs[0].text_content(), "You are helpful.");
    }

    #[test]
    fn test_system_user() {
        let msgs = parse_chat("system:\nYou are helpful.\n\nuser:\nHello");
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].role, Role::System);
        assert_eq!(msgs[0].text_content(), "You are helpful.");
        assert_eq!(msgs[1].role, Role::User);
        assert_eq!(msgs[1].text_content(), "Hello");
    }

    #[test]
    fn test_system_user_assistant() {
        let msgs = parse_chat("system:\nBe concise.\n\nuser:\nHi\n\nassistant:\nHello! How can I help?");
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[0].role, Role::System);
        assert_eq!(msgs[1].role, Role::User);
        assert_eq!(msgs[2].role, Role::Assistant);
        assert_eq!(msgs[2].text_content(), "Hello! How can I help?");
    }

    #[test]
    fn test_multiline_content() {
        let msgs = parse_chat("system:\nLine one.\nLine two.\nLine three.\n\nuser:\nQuestion?");
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].text_content(), "Line one.\nLine two.\nLine three.");
    }

    #[test]
    fn test_no_role_marker_defaults_to_system() {
        let msgs = parse_chat("Just some plain text.");
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].role, Role::System);
        assert_eq!(msgs[0].text_content(), "Just some plain text.");
    }

    #[test]
    fn test_empty_content() {
        let msgs = parse_chat("system:\n\nuser:\nHello");
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].role, Role::System);
        assert_eq!(msgs[0].text_content(), "");
        assert_eq!(msgs[1].role, Role::User);
        assert_eq!(msgs[1].text_content(), "Hello");
    }

    #[test]
    fn test_role_marker_at_line_start_only() {
        let msgs = parse_chat("system:\nThe user: said hello");
        assert_eq!(msgs.len(), 1);
        // "user:" mid-line is NOT a role marker
        assert_eq!(msgs[0].text_content(), "The user: said hello");
    }

    #[test]
    fn test_markdown_preserved() {
        let msgs = parse_chat("system:\n# Heading\n\n- item 1\n- item 2\n\n**bold**");
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].text_content().contains("# Heading"));
        assert!(msgs[0].text_content().contains("**bold**"));
    }

    #[test]
    fn test_code_block_preserved() {
        let input = "assistant:\nHere's code:\n```python\ndef hello():\n    print('hi')\n```";
        let msgs = parse_chat(input);
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].text_content().contains("```python"));
    }

    #[test]
    fn test_colon_in_content() {
        let msgs = parse_chat("user:\nLet's meet at 3:30pm");
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].text_content(), "Let's meet at 3:30pm");
    }

    #[test]
    fn test_consecutive_newlines_trimmed() {
        let msgs = parse_chat("system:\n\n\nContent\n\n\n\nuser:\nHello");
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].text_content(), "Content");
        assert_eq!(msgs[1].text_content(), "Hello");
    }

    #[test]
    fn test_developer_role() {
        let msgs = parse_chat("developer:\nYou are a helpful AI.");
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].role, Role::Developer);
    }

    #[test]
    fn test_multiple_turns() {
        let input = "system:\nBe helpful.\n\nuser:\nQ1\n\nassistant:\nA1\n\nuser:\nQ2";
        let msgs = parse_chat(input);
        assert_eq!(msgs.len(), 4);
        assert_eq!(msgs[0].role, Role::System);
        assert_eq!(msgs[1].role, Role::User);
        assert_eq!(msgs[2].role, Role::Assistant);
        assert_eq!(msgs[3].role, Role::User);
    }

    #[test]
    fn test_boundary_regex() {
        assert!(BOUNDARY_RE.is_match("system:"));
        assert!(BOUNDARY_RE.is_match("  user:  "));
        assert!(BOUNDARY_RE.is_match("# assistant:"));
        assert!(BOUNDARY_RE.is_match("SYSTEM:"));
        assert!(!BOUNDARY_RE.is_match("not a role:"));
        assert!(!BOUNDARY_RE.is_match("system: with extra text"));
    }
}
