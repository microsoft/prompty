//! Context window trimming — estimate prompt size and trim messages to fit.
//!
//! Matches TypeScript `core/context.ts`. Used by `turn()` to keep the
//! conversation within the model's context window budget.

use crate::types::{ContentPart, Message, Role};

// ---------------------------------------------------------------------------
// Character estimation
// ---------------------------------------------------------------------------

/// Estimate the character count of a message list.
///
/// Uses the same heuristic as TypeScript:
/// - Role name length + 4 (for formatting overhead)
/// - Text parts: character count
/// - Non-text parts: 200 chars each (images, files, audio)
/// - Tool calls in metadata: JSON stringified length
pub fn estimate_chars(messages: &[Message]) -> usize {
    let mut total = 0;

    for msg in messages {
        // Role overhead
        total += msg.role.to_string().len() + 4;

        // Content parts
        for part in &msg.parts {
            match part {
                ContentPart::Text(t) => total += t.value.len(),
                ContentPart::Image(_) | ContentPart::File(_) | ContentPart::Audio(_) => {
                    total += 200;
                }
            }
        }

        // Tool calls in metadata
        if let Some(tc) = msg.metadata.get("tool_calls") {
            if let Ok(s) = serde_json::to_string(tc) {
                total += s.len();
            }
        }
    }

    total
}

// ---------------------------------------------------------------------------
// Summary generation
// ---------------------------------------------------------------------------

/// Generate a summary string for dropped messages.
///
/// Used as a synthetic `user` message when messages are trimmed.
pub fn summarize_dropped(messages: &[Message]) -> String {
    if messages.is_empty() {
        return String::new();
    }

    let mut parts: Vec<String> = Vec::new();
    for msg in messages {
        let role = msg.role.to_string();
        let text = msg.text_content();
        if text.is_empty() {
            parts.push(format!("[{role} message]"));
        } else {
            // Truncate long messages
            let truncated = if text.len() > 200 {
                format!("{}...", &text[..200])
            } else {
                text.to_string()
            };
            parts.push(format!("[{role}]: {truncated}"));
        }
    }

    let summary = parts.join("\n");

    // Cap at 4000 chars (matches TypeScript)
    if summary.len() > 4000 {
        format!("{}...", &summary[..4000])
    } else {
        summary
    }
}

// ---------------------------------------------------------------------------
// Context trimming
// ---------------------------------------------------------------------------

/// Trim messages to fit within a character budget.
///
/// Returns `(dropped_count, trimmed_messages)`.
///
/// Behavior (matches TypeScript):
/// 1. System messages at the start are always preserved
/// 2. Drops non-system messages from the front (oldest first)
/// 3. Keeps at least 2 non-system messages
/// 4. If anything was dropped, inserts a synthetic `user` summary message
///    after the system messages
///
/// The summary budget is `min(5000, 5% of budget_chars)`.
pub fn trim_to_context_window(messages: &[Message], budget_chars: usize) -> (usize, Vec<Message>) {
    let current = estimate_chars(messages);
    if current <= budget_chars {
        return (0, messages.to_vec());
    }

    // Split: leading system messages + rest
    let system_count = messages
        .iter()
        .take_while(|m| m.role == Role::System)
        .count();
    let system_msgs = &messages[..system_count];
    let rest = &messages[system_count..];

    // Keep at least 2 non-system messages
    if rest.len() <= 2 {
        return (0, messages.to_vec());
    }

    let system_chars = estimate_chars(system_msgs);
    let summary_budget = std::cmp::min(5000, budget_chars / 20); // 5% of budget
    let available = budget_chars.saturating_sub(system_chars + summary_budget);

    // Drop from the front of `rest` until we fit
    let mut drop_count = 0;
    let mut rest_chars = estimate_chars(rest);

    while rest_chars > available && drop_count < rest.len().saturating_sub(2) {
        let drop_msg = &rest[drop_count];
        rest_chars -= estimate_chars(std::slice::from_ref(drop_msg));
        drop_count += 1;
    }

    if drop_count == 0 {
        return (0, messages.to_vec());
    }

    // Build the trimmed message list
    let dropped = &rest[..drop_count];
    let kept = &rest[drop_count..];

    let summary_text = summarize_dropped(dropped);
    let summary_msg = Message::text(
        Role::User,
        &format!("[Context summary: {summary_text}\n... ({drop_count} messages omitted)]"),
    );

    let mut result = Vec::with_capacity(system_msgs.len() + 1 + kept.len());
    result.extend_from_slice(system_msgs);
    result.push(summary_msg);
    result.extend_from_slice(kept);

    (drop_count, result)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(role: Role, text: &str) -> Message {
        Message::text(role, text)
    }

    #[test]
    fn test_estimate_chars_basic() {
        let msgs = vec![
            msg(Role::System, "You are helpful."),
            msg(Role::User, "Hello!"),
        ];
        let chars = estimate_chars(&msgs);
        // "system" (6) + 4 + 16 + "user" (4) + 4 + 6 = 40
        assert_eq!(chars, 40);
    }

    #[test]
    fn test_estimate_chars_empty() {
        assert_eq!(estimate_chars(&[]), 0);
    }

    #[test]
    fn test_estimate_chars_with_tool_calls() {
        let mut m = msg(Role::Assistant, "");
        m.metadata.insert(
            "tool_calls".into(),
            serde_json::json!([{"name": "get_weather", "arguments": "{\"city\":\"NY\"}"}]),
        );
        let chars = estimate_chars(&[m]);
        assert!(chars > 10); // role overhead + tool_calls JSON
    }

    #[test]
    fn test_summarize_dropped_empty() {
        assert_eq!(summarize_dropped(&[]), "");
    }

    #[test]
    fn test_summarize_dropped_basic() {
        let msgs = vec![msg(Role::User, "Hello"), msg(Role::Assistant, "Hi there")];
        let summary = summarize_dropped(&msgs);
        assert!(summary.contains("[user]: Hello"));
        assert!(summary.contains("[assistant]: Hi there"));
    }

    #[test]
    fn test_summarize_dropped_truncates_long_messages() {
        let long_text = "x".repeat(500);
        let msgs = vec![msg(Role::User, &long_text)];
        let summary = summarize_dropped(&msgs);
        assert!(summary.len() < 500);
        assert!(summary.ends_with("..."));
    }

    #[test]
    fn test_trim_under_budget() {
        let msgs = vec![msg(Role::System, "sys"), msg(Role::User, "hi")];
        let (dropped, result) = trim_to_context_window(&msgs, 100_000);
        assert_eq!(dropped, 0);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_trim_drops_oldest() {
        let msgs = vec![
            msg(Role::System, "sys"),
            msg(Role::User, &"A".repeat(1000)),
            msg(Role::User, &"B".repeat(1000)),
            msg(Role::User, &"C".repeat(100)),
            msg(Role::User, &"D".repeat(100)),
        ];
        // Budget that can't fit all messages
        let (dropped, result) = trim_to_context_window(&msgs, 500);
        assert!(dropped > 0);
        // System message preserved
        assert_eq!(result[0].role, Role::System);
        // Summary message inserted
        assert!(result[1].text_content().contains("messages omitted"));
        // At least 2 non-system messages kept (summary + at least 2 originals)
        assert!(result.len() >= 4); // system + summary + at least 2
    }

    #[test]
    fn test_trim_preserves_system_messages() {
        let msgs = vec![
            msg(Role::System, "sys1"),
            msg(Role::System, "sys2"),
            msg(Role::User, &"A".repeat(2000)),
            msg(Role::User, &"B".repeat(100)),
            msg(Role::User, &"C".repeat(100)),
        ];
        let (_, result) = trim_to_context_window(&msgs, 500);
        // Both system messages preserved
        assert_eq!(result[0].role, Role::System);
        assert_eq!(result[0].text_content(), "sys1");
        assert_eq!(result[1].role, Role::System);
        assert_eq!(result[1].text_content(), "sys2");
    }

    #[test]
    fn test_trim_keeps_minimum_messages() {
        let msgs = vec![
            msg(Role::System, "sys"),
            msg(Role::User, &"A".repeat(5000)),
            msg(Role::User, &"B".repeat(5000)),
        ];
        // Even with tiny budget, keep at least 2 non-system messages
        let (dropped, result) = trim_to_context_window(&msgs, 10);
        assert_eq!(dropped, 0);
        assert_eq!(result.len(), 3);
    }
}
