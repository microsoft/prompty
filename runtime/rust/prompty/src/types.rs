//! Core pipeline types — `Message`, `ContentPart`, `ToolCall`, `PromptyStream`,
//! `StructuredResult`.
//!
//! These mirror the TypeScript definitions in `@prompty/core/types.ts`
//! and follow the spec at `spec/spec.md` §6.5.

use std::fmt;

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Role
// ---------------------------------------------------------------------------

/// Message roles per spec §6.5. Includes `developer` (alias for system in some
/// providers) and `tool` (for tool-call results).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
    Developer,
    Tool,
}

impl fmt::Display for Role {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::System => write!(f, "system"),
            Self::User => write!(f, "user"),
            Self::Assistant => write!(f, "assistant"),
            Self::Developer => write!(f, "developer"),
            Self::Tool => write!(f, "tool"),
        }
    }
}

impl Role {
    /// Parse a role string (case-insensitive). Returns `None` for unrecognised values.
    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "system" => Some(Self::System),
            "user" => Some(Self::User),
            "assistant" => Some(Self::Assistant),
            "developer" => Some(Self::Developer),
            "tool" => Some(Self::Tool),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// ContentPart
// ---------------------------------------------------------------------------

/// A piece of message content. Matches the tagged union from the spec.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum ContentPart {
    #[serde(rename = "text")]
    Text(TextPart),
    #[serde(rename = "image")]
    Image(ImagePart),
    #[serde(rename = "file")]
    File(FilePart),
    #[serde(rename = "audio")]
    Audio(AudioPart),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextPart {
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImagePart {
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FilePart {
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AudioPart {
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
}

// ---------------------------------------------------------------------------
// ToolCall
// ---------------------------------------------------------------------------

/// A tool call returned by the LLM (spec §6.5.4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    /// JSON-encoded arguments string.
    pub arguments: String,
}

// ---------------------------------------------------------------------------
// ThreadMarker
// ---------------------------------------------------------------------------

/// Placeholder inserted during rendering for `kind: thread` inputs.
/// The pipeline replaces these with actual `Message` lists from inputs.
#[derive(Debug, Clone, PartialEq)]
pub struct ThreadMarker {
    pub name: String,
    pub nonce: String,
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

/// A chat message with typed content parts and optional metadata.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub parts: Vec<ContentPart>,
    #[serde(default, skip_serializing_if = "serde_json::Map::is_empty")]
    pub metadata: serde_json::Map<String, serde_json::Value>,
}

impl Message {
    /// Create a new message with a single text part.
    pub fn text(role: Role, content: impl Into<String>) -> Self {
        Self {
            role,
            parts: vec![ContentPart::Text(TextPart {
                value: content.into(),
            })],
            metadata: serde_json::Map::new(),
        }
    }

    /// Create a tool-result message.
    pub fn tool_result(tool_call_id: impl Into<String>, content: impl Into<String>) -> Self {
        let mut metadata = serde_json::Map::new();
        metadata.insert(
            "tool_call_id".to_string(),
            serde_json::Value::String(tool_call_id.into()),
        );
        Self {
            role: Role::Tool,
            parts: vec![ContentPart::Text(TextPart {
                value: content.into(),
            })],
            metadata,
        }
    }

    /// Concatenate all text parts into a single string.
    pub fn text_content(&self) -> String {
        self.parts
            .iter()
            .filter_map(|p| match p {
                ContentPart::Text(t) => Some(t.value.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("")
    }

    /// Convert to provider wire format: returns a plain string if a single
    /// text part, otherwise returns a JSON array of part objects.
    pub fn to_text_content(&self) -> serde_json::Value {
        if self.parts.len() == 1 {
            if let ContentPart::Text(t) = &self.parts[0] {
                return serde_json::Value::String(t.value.clone());
            }
        }
        serde_json::to_value(&self.parts).unwrap_or(serde_json::Value::Array(vec![]))
    }

    /// True if this message has any non-text content parts.
    pub fn has_rich_content(&self) -> bool {
        self.parts
            .iter()
            .any(|p| !matches!(p, ContentPart::Text(_)))
    }
}

// ---------------------------------------------------------------------------
// PromptyStream
// ---------------------------------------------------------------------------

/// Wrapper for streaming LLM responses with tracing support.
///
/// `PromptyStream` wraps an inner async stream (from the executor/processor)
/// and acts as both an `AsyncIterator` and a chunk accumulator. As chunks flow
/// through, they are buffered in `items` for tracing. When the stream is
/// exhausted (or explicitly flushed), a trace span is emitted.
///
/// This matches TypeScript's `PromptyStream` which implements `AsyncIterable<unknown>`.
///
/// # Usage
///
/// ```rust
/// use prompty::types::PromptyStream;
/// use serde_json::json;
///
/// // Create from collected chunks (non-streaming usage / testing)
/// let mut stream = PromptyStream::new("chat.streaming");
/// stream.push(json!({"delta": {"content": "Hello"}}));
/// stream.push(json!({"delta": {"content": " world"}}));
/// assert_eq!(stream.len(), 2);
///
/// // When done, flush emits a trace span with all collected items
/// stream.flush();
/// ```
pub struct PromptyStream {
    /// Span name for tracing.
    pub name: String,
    /// Collected chunks.
    pub items: Vec<serde_json::Value>,
    /// Optional inner async stream for streaming mode.
    /// When present, `poll_next` pulls from this and buffers into `items`.
    inner: Option<std::pin::Pin<Box<dyn futures::Stream<Item = serde_json::Value> + Send>>>,
    /// Whether the stream has been exhausted (inner drained).
    exhausted: bool,
}

impl PromptyStream {
    /// Create a new PromptyStream (buffer-only mode, no inner stream).
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            items: Vec::new(),
            inner: None,
            exhausted: false,
        }
    }

    /// Create a PromptyStream wrapping an inner async stream.
    ///
    /// Chunks from the inner stream will be buffered in `items` as they are
    /// yielded, and a trace span is emitted when the stream is exhausted.
    pub fn from_stream(
        name: impl Into<String>,
        inner: impl futures::Stream<Item = serde_json::Value> + Send + 'static,
    ) -> Self {
        Self {
            name: name.into(),
            items: Vec::new(),
            inner: Some(Box::pin(inner)),
            exhausted: false,
        }
    }

    /// Record a chunk (buffer-only mode).
    pub fn push(&mut self, chunk: serde_json::Value) {
        self.items.push(chunk);
    }

    /// Number of collected chunks.
    pub fn len(&self) -> usize {
        self.items.len()
    }

    /// Whether any chunks have been collected.
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// Whether this stream wraps an inner async stream.
    pub fn is_streaming(&self) -> bool {
        self.inner.is_some()
    }

    /// Flush the stream: emit a tracer span with signature, inputs, and result.
    /// Matches TypeScript's `PromptyStream[Symbol.asyncDispose]`.
    pub fn flush(&self) {
        if self.items.is_empty() {
            return;
        }
        let span = crate::tracing::Tracer::start(&self.name);
        span.emit(
            "signature",
            &serde_json::Value::String(format!("{}.PromptyStream", self.name)),
        );
        span.emit("inputs", &serde_json::Value::String("None".into()));
        span.emit("result", &serde_json::Value::Array(self.items.clone()));
        span.end();
    }

    /// Extract accumulated text content from delta chunks (OpenAI format).
    /// Concatenates all `choices[0].delta.content` strings.
    pub fn collect_text(&self) -> String {
        let mut text = String::new();
        for item in &self.items {
            if let Some(content) = item
                .pointer("/choices/0/delta/content")
                .and_then(|v| v.as_str())
            {
                text.push_str(content);
            }
        }
        text
    }

    /// Extract accumulated tool calls from delta chunks (OpenAI format).
    /// Merges tool_calls deltas across chunks.
    pub fn collect_tool_calls(&self) -> Vec<crate::types::ToolCall> {
        use std::collections::BTreeMap;
        let mut calls: BTreeMap<usize, (String, String, String)> = BTreeMap::new(); // index -> (id, name, args)
        for item in &self.items {
            if let Some(tcs) = item
                .pointer("/choices/0/delta/tool_calls")
                .and_then(|v| v.as_array())
            {
                for tc in tcs {
                    let idx = tc.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                    let id = tc
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let name = tc
                        .pointer("/function/name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let args = tc
                        .pointer("/function/arguments")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let entry = calls.entry(idx);
                    let (existing_id, existing_name, existing_args) =
                        entry.or_insert_with(|| (String::new(), String::new(), String::new()));
                    if !id.is_empty() {
                        *existing_id = id;
                    }
                    if !name.is_empty() {
                        *existing_name = name;
                    }
                    existing_args.push_str(&args);
                }
            }
        }
        calls
            .into_iter()
            .map(|(_, (id, name, arguments))| crate::types::ToolCall {
                id,
                name,
                arguments,
            })
            .collect()
    }

    /// Consume the stream, collecting all chunks. Returns the collected items.
    ///
    /// If this stream has an inner async stream, drains it completely.
    /// If it's buffer-only, returns the existing items.
    pub async fn collect_all(&mut self) -> &[serde_json::Value] {
        if let Some(mut inner) = self.inner.take() {
            use futures::StreamExt;
            while let Some(chunk) = inner.next().await {
                self.items.push(chunk);
            }
            self.exhausted = true;
        }
        &self.items
    }
}

impl futures::Stream for PromptyStream {
    type Item = serde_json::Value;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        if let Some(ref mut inner) = self.inner {
            match inner.as_mut().poll_next(cx) {
                std::task::Poll::Ready(Some(chunk)) => {
                    self.items.push(chunk.clone());
                    std::task::Poll::Ready(Some(chunk))
                }
                std::task::Poll::Ready(None) => {
                    // Stream exhausted — flush trace
                    self.exhausted = true;
                    self.flush();
                    self.inner = None;
                    std::task::Poll::Ready(None)
                }
                std::task::Poll::Pending => std::task::Poll::Pending,
            }
        } else {
            // No inner stream — nothing to poll
            std::task::Poll::Ready(None)
        }
    }
}

impl Drop for PromptyStream {
    fn drop(&mut self) {
        // If the stream was never fully consumed, flush what we have
        if !self.exhausted && !self.items.is_empty() {
            self.flush();
        }
    }
}

// ---------------------------------------------------------------------------
// StreamChunk — yielded from processor stream generators
// ---------------------------------------------------------------------------

/// A chunk yielded by a processor's stream generator.
///
/// Matches TypeScript's `string | ToolCall` union yielded by `streamGenerator`.
#[derive(Debug, Clone)]
pub enum StreamChunk {
    /// A text content token.
    Text(String),
    /// A thinking/reasoning token from the LLM.
    Thinking(String),
    /// A completed tool call (yielded at end of stream).
    Tool(ToolCall),
    /// A stream error (e.g., model refusal). Consumers MUST stop iteration.
    Error(String),
}

// ---------------------------------------------------------------------------
// consume_stream — drains a processed stream into text + tool calls
// ---------------------------------------------------------------------------

/// Consume a stream of `StreamChunk`s, collecting text content and tool calls.
///
/// Matches TypeScript's `consumeStream()` in `pipeline.ts`.
/// Returns `(tool_calls, content_text)`.
pub async fn consume_stream_chunks(
    stream: impl futures::Stream<Item = StreamChunk> + Unpin,
    on_token: Option<&dyn Fn(&str)>,
) -> (Vec<ToolCall>, String) {
    use futures::StreamExt;

    let mut tool_calls = Vec::new();
    let mut text_parts = Vec::new();

    futures::pin_mut!(stream);
    while let Some(chunk) = stream.next().await {
        match chunk {
            StreamChunk::Text(t) => {
                if let Some(cb) = on_token {
                    cb(&t);
                }
                text_parts.push(t);
            }
            StreamChunk::Thinking(_) => {
                // Thinking tokens are informational; not collected into output
            }
            StreamChunk::Tool(tc) => {
                tool_calls.push(tc);
            }
            StreamChunk::Error(_) => {
                // Error chunks signal stream termination; stop consuming
                break;
            }
        }
    }

    (tool_calls, text_parts.join(""))
}

impl fmt::Debug for PromptyStream {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PromptyStream")
            .field("name", &self.name)
            .field("items_len", &self.items.len())
            .field("is_streaming", &self.inner.is_some())
            .field("exhausted", &self.exhausted)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_text() {
        let msg = Message::text(Role::User, "Hello");
        assert_eq!(msg.role, Role::User);
        assert_eq!(msg.text_content(), "Hello");
        assert!(!msg.has_rich_content());
    }

    #[test]
    fn test_message_multipart_text() {
        let msg = Message {
            role: Role::Assistant,
            parts: vec![
                ContentPart::Text(TextPart {
                    value: "Hello ".into(),
                }),
                ContentPart::Text(TextPart {
                    value: "world".into(),
                }),
            ],
            metadata: serde_json::Map::new(),
        };
        assert_eq!(msg.text_content(), "Hello world");
    }

    #[test]
    fn test_message_rich_content() {
        let msg = Message {
            role: Role::User,
            parts: vec![
                ContentPart::Text(TextPart {
                    value: "Look at this:".into(),
                }),
                ContentPart::Image(ImagePart {
                    source: "https://example.com/img.png".into(),
                    detail: Some("high".into()),
                    media_type: None,
                }),
            ],
            metadata: serde_json::Map::new(),
        };
        assert!(msg.has_rich_content());
    }

    #[test]
    fn test_to_text_content_single() {
        let msg = Message::text(Role::User, "simple");
        assert_eq!(
            msg.to_text_content(),
            serde_json::Value::String("simple".into())
        );
    }

    #[test]
    fn test_to_text_content_multipart() {
        let msg = Message {
            role: Role::User,
            parts: vec![
                ContentPart::Text(TextPart {
                    value: "Hello".into(),
                }),
                ContentPart::Image(ImagePart {
                    source: "data:image/png;base64,abc".into(),
                    detail: None,
                    media_type: None,
                }),
            ],
            metadata: serde_json::Map::new(),
        };
        let content = msg.to_text_content();
        assert!(content.is_array());
    }

    #[test]
    fn test_tool_result_message() {
        let msg = Message::tool_result("call_123", r#"{"temp": 72}"#);
        assert_eq!(msg.role, Role::Tool);
        assert_eq!(msg.text_content(), r#"{"temp": 72}"#);
        assert_eq!(
            msg.metadata.get("tool_call_id").and_then(|v| v.as_str()),
            Some("call_123")
        );
    }

    #[test]
    fn test_role_display() {
        assert_eq!(Role::System.to_string(), "system");
        assert_eq!(Role::Assistant.to_string(), "assistant");
    }

    #[test]
    fn test_role_from_str() {
        assert_eq!(Role::from_str_opt("System"), Some(Role::System));
        assert_eq!(Role::from_str_opt("USER"), Some(Role::User));
        assert_eq!(Role::from_str_opt("unknown"), None);
    }

    #[test]
    fn test_message_serde_roundtrip() {
        let msg = Message::text(Role::User, "Hello");
        let json = serde_json::to_string(&msg).unwrap();
        let deserialized: Message = serde_json::from_str(&json).unwrap();
        assert_eq!(msg, deserialized);
    }

    #[test]
    fn test_tool_call_serde() {
        let tc = ToolCall {
            id: "call_abc".into(),
            name: "get_weather".into(),
            arguments: r#"{"city":"Seattle"}"#.into(),
        };
        let json = serde_json::to_value(&tc).unwrap();
        assert_eq!(json["id"], "call_abc");
        assert_eq!(json["name"], "get_weather");
    }

    // PromptyStream tests
    #[test]
    fn test_prompty_stream_new() {
        let stream = PromptyStream::new("test-stream");
        assert_eq!(stream.name, "test-stream");
        assert!(stream.items.is_empty());
    }

    #[test]
    fn test_prompty_stream_push() {
        let mut stream = PromptyStream::new("test");
        stream.push(serde_json::json!({"chunk": 1}));
        stream.push(serde_json::json!({"chunk": 2}));
        assert_eq!(stream.items.len(), 2);
        assert_eq!(stream.items[0]["chunk"], 1);
        assert_eq!(stream.items[1]["chunk"], 2);
    }

    #[test]
    fn test_prompty_stream_debug() {
        let mut stream = PromptyStream::new("debug-test");
        stream.push(serde_json::json!("chunk"));
        let dbg = format!("{:?}", stream);
        assert!(dbg.contains("debug-test"));
        assert!(dbg.contains("items_len: 1"));
    }

    // Edge case: message with no parts
    #[test]
    fn test_message_empty_text_content() {
        let msg = Message {
            role: Role::User,
            parts: vec![],
            metadata: serde_json::Map::new(),
        };
        assert_eq!(msg.text_content(), "");
        assert!(!msg.has_rich_content());
    }

    // Edge case: tool_result and its metadata
    #[test]
    fn test_tool_result_metadata_fields() {
        let msg = Message::tool_result("call_99", "result text");
        assert_eq!(msg.metadata["tool_call_id"], "call_99");
        assert_eq!(msg.role, Role::Tool);
    }
}
