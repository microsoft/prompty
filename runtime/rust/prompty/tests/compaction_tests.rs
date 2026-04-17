//! Tests for context compaction feature.

use std::sync::Arc;

use prompty::context::{format_dropped_messages, trim_to_context_window};
use prompty::types::{Message, Role};
use prompty::{Compaction, CompactionFn, TurnOptions};

// ---------------------------------------------------------------------------
// format_dropped_messages
// ---------------------------------------------------------------------------

#[test]
fn test_format_dropped_messages_basic() {
    let msgs = vec![
        Message::with_text(Role::User, "Hello there"),
        Message::with_text(Role::Assistant, "Hi! How can I help?"),
    ];
    let formatted = format_dropped_messages(&msgs);
    assert!(formatted.contains("[user]: Hello there"));
    assert!(formatted.contains("[assistant]: Hi! How can I help?"));
}

#[test]
fn test_format_dropped_messages_with_tool_calls() {
    let mut m = Message::with_text(Role::Assistant, "");
    m.metadata_mut().insert(
        "tool_calls".into(),
        serde_json::json!([{"name": "get_weather", "arguments": "{\"city\":\"NY\"}"}]),
    );
    let formatted = format_dropped_messages(&[m]);
    assert!(
        formatted.contains("Called: get_weather"),
        "should contain tool call name"
    );
    assert!(
        formatted.contains("NY"),
        "should contain tool call arguments"
    );
}

#[test]
fn test_format_dropped_messages_empty() {
    assert_eq!(format_dropped_messages(&[]), "");
}

#[test]
fn test_format_dropped_messages_multiple_tool_calls() {
    let mut m = Message::with_text(Role::Assistant, "");
    m.metadata_mut().insert(
        "tool_calls".into(),
        serde_json::json!([
            {"name": "get_weather", "arguments": "{\"city\":\"NY\"}"},
            {"name": "search", "arguments": "{\"q\":\"hello\"}"},
        ]),
    );
    let formatted = format_dropped_messages(&[m]);
    assert!(formatted.contains("Called: get_weather"));
    assert!(formatted.contains("Called: search"));
}

// ---------------------------------------------------------------------------
// trim_to_context_window returns dropped messages
// ---------------------------------------------------------------------------

#[test]
fn test_trim_returns_dropped_messages() {
    let msgs = vec![
        Message::with_text(Role::System, "sys"),
        Message::with_text(Role::User, &"A".repeat(1000)),
        Message::with_text(Role::User, &"B".repeat(1000)),
        Message::with_text(Role::User, &"C".repeat(100)),
        Message::with_text(Role::User, &"D".repeat(100)),
    ];
    let (dropped, trimmed) = trim_to_context_window(&msgs, 500);
    assert!(!dropped.is_empty(), "should have dropped messages");
    // Dropped messages are the oldest non-system ones
    assert_eq!(dropped[0].role, Role::User);
    assert!(dropped[0].text_content().starts_with('A'));
    // Trimmed should contain summary message
    assert!(trimmed[1].text_content().contains("Context summary"));
}

#[test]
fn test_trim_under_budget_returns_empty_dropped() {
    let msgs = vec![
        Message::with_text(Role::System, "sys"),
        Message::with_text(Role::User, "hi"),
    ];
    let (dropped, result) = trim_to_context_window(&msgs, 100_000);
    assert!(dropped.is_empty());
    assert_eq!(result.len(), 2);
}

// ---------------------------------------------------------------------------
// TurnOptions default
// ---------------------------------------------------------------------------

#[test]
fn test_compaction_none_default() {
    let opts = TurnOptions::default();
    assert!(opts.compaction.is_none());
}

// ---------------------------------------------------------------------------
// Compaction::Function replaces summary
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_compaction_function_replaces_summary() {
    // Build messages that will exceed budget and be trimmed
    let mut messages = vec![
        Message::with_text(Role::System, "sys"),
        // The summary message (simulating what trim_to_context_window produces)
        Message::with_text(
            Role::User,
            "[Context summary: [user]: old content\n... (1 messages omitted)]",
        ),
        Message::with_text(Role::User, "recent message"),
    ];

    let compaction_fn: CompactionFn = Arc::new(|_dropped: &[Message]| {
        Box::pin(async { Ok("LLM-powered summary of the conversation".to_string()) })
    });

    let dropped = vec![Message::with_text(
        Role::User,
        "old content that was dropped",
    )];

    let span = prompty::tracing::Tracer::start("test");
    prompty::pipeline::apply_compaction(
        &Compaction::Function(compaction_fn),
        &dropped,
        &mut messages,
        &span,
    )
    .await;
    span.end();

    // The summary message should be replaced
    let summary_msg = &messages[1];
    assert_eq!(summary_msg.role, Role::User);
    assert!(
        summary_msg
            .text_content()
            .contains("LLM-powered summary of the conversation"),
        "summary should be replaced: got {}",
        summary_msg.text_content()
    );
}

// ---------------------------------------------------------------------------
// Compaction failure preserves default summary
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_compaction_failure_preserves_default() {
    let original_summary = "[Context summary: [user]: old stuff\n... (1 messages omitted)]";
    let mut messages = vec![
        Message::with_text(Role::System, "sys"),
        Message::with_text(Role::User, original_summary),
        Message::with_text(Role::User, "recent"),
    ];

    let compaction_fn: CompactionFn = Arc::new(|_dropped: &[Message]| {
        Box::pin(async { Err("model unavailable".to_string().into()) })
    });

    let dropped = vec![Message::with_text(Role::User, "dropped content")];

    let span = prompty::tracing::Tracer::start("test");
    prompty::pipeline::apply_compaction(
        &Compaction::Function(compaction_fn),
        &dropped,
        &mut messages,
        &span,
    )
    .await;
    span.end();

    // Original summary should be preserved
    assert_eq!(messages[1].text_content(), original_summary);
}

// ---------------------------------------------------------------------------
// Compaction returning empty string preserves default
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_compaction_empty_result_preserves_default() {
    let original_summary = "[Context summary: [user]: stuff\n... (1 messages omitted)]";
    let mut messages = vec![
        Message::with_text(Role::System, "sys"),
        Message::with_text(Role::User, original_summary),
        Message::with_text(Role::User, "recent"),
    ];

    let compaction_fn: CompactionFn = Arc::new(|_dropped: &[Message]| {
        Box::pin(async { Ok("   ".to_string()) }) // whitespace-only
    });

    let dropped = vec![Message::with_text(Role::User, "dropped")];

    let span = prompty::tracing::Tracer::start("test");
    prompty::pipeline::apply_compaction(
        &Compaction::Function(compaction_fn),
        &dropped,
        &mut messages,
        &span,
    )
    .await;
    span.end();

    assert_eq!(messages[1].text_content(), original_summary);
}

// ---------------------------------------------------------------------------
// Compaction function receives the dropped messages
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_compaction_receives_dropped_messages() {
    use std::sync::atomic::{AtomicUsize, Ordering};

    let count = Arc::new(AtomicUsize::new(0));
    let count_clone = count.clone();

    let compaction_fn: CompactionFn = Arc::new(move |dropped: &[Message]| {
        count_clone.store(dropped.len(), Ordering::SeqCst);
        Box::pin(async { Ok("summary".to_string()) })
    });

    let mut messages = vec![
        Message::with_text(Role::System, "sys"),
        Message::with_text(
            Role::User,
            "[Context summary: old\n... (2 messages omitted)]",
        ),
        Message::with_text(Role::User, "recent"),
    ];

    let dropped = vec![
        Message::with_text(Role::User, "msg1"),
        Message::with_text(Role::User, "msg2"),
    ];

    let span = prompty::tracing::Tracer::start("test");
    prompty::pipeline::apply_compaction(
        &Compaction::Function(compaction_fn),
        &dropped,
        &mut messages,
        &span,
    )
    .await;
    span.end();

    assert_eq!(count.load(Ordering::SeqCst), 2);
}
