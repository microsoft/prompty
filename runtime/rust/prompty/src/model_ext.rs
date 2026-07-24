//! Extension methods for generated model types.
//!
//! The TypeSpec emitter generates the model structs in `model/`. This module
//! adds convenience accessors, trait impls (PartialEq, Serialize, Deserialize),
//! and helper methods used by the pipeline and other hand-written code.

use crate::model::{
    ContentPart, ContentPartKind, Message, MessageHelpers, Prompty, Property, Role, Tool,
    ToolResult, ToolResultHelpers,
};

// ---------------------------------------------------------------------------
// Prompty helpers
// ---------------------------------------------------------------------------

impl Prompty {
    /// Returns a reference to the input properties, or `None` if empty.
    pub fn as_inputs(&self) -> Option<&Vec<Property>> {
        if self.inputs.is_empty() {
            None
        } else {
            Some(&self.inputs)
        }
    }

    /// Returns a reference to the output properties, or `None` if empty.
    pub fn as_outputs(&self) -> Option<&Vec<Property>> {
        if self.outputs.is_empty() {
            None
        } else {
            Some(&self.outputs)
        }
    }

    /// Returns a reference to the tools list, or `None` if empty.
    pub fn as_tools(&self) -> Option<&Vec<Tool>> {
        if self.tools.is_empty() {
            None
        } else {
            Some(&self.tools)
        }
    }
}

// ---------------------------------------------------------------------------
// MessageHelpers — concatenate TextPart values
// ---------------------------------------------------------------------------

impl MessageHelpers for Message {
    fn to_text_content(&self) -> serde_json::Value {
        // If all parts are text, return a single joined string.
        // Otherwise return an array of content part dicts for wire serialization.
        let all_text = self
            .parts
            .iter()
            .all(|p| matches!(&p.kind, ContentPartKind::TextPart { .. }));
        if all_text {
            let text = self
                .parts
                .iter()
                .filter_map(|p| match &p.kind {
                    ContentPartKind::TextPart { value } => Some(value.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n");
            serde_json::Value::String(text)
        } else {
            use crate::model::context::SaveContext;
            let ctx = SaveContext::default();
            serde_json::Value::Array(self.parts.iter().map(|p| p.to_value(&ctx)).collect())
        }
    }

    fn text(&self) -> String {
        self.parts
            .iter()
            .filter_map(|p| match &p.kind {
                ContentPartKind::TextPart { value } => Some(value.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

// ---------------------------------------------------------------------------
// ToolResultHelpers — concatenate TextPart values
// ---------------------------------------------------------------------------

impl ToolResultHelpers for ToolResult {
    fn text(&self) -> String {
        self.parts
            .iter()
            .filter_map(|p| match &p.kind {
                ContentPartKind::TextPart { value } => Some(value.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

// ---------------------------------------------------------------------------
// ContentPart convenience constructors
// ---------------------------------------------------------------------------

impl ContentPart {
    /// Create a text content part.
    pub fn text(value: impl Into<String>) -> Self {
        Self {
            kind: ContentPartKind::TextPart {
                value: value.into(),
            },
        }
    }

    /// Create an image content part.
    pub fn image(
        source: impl Into<String>,
        detail: Option<String>,
        media_type: Option<String>,
    ) -> Self {
        Self {
            kind: ContentPartKind::ImagePart {
                source: source.into(),
                detail,
                media_type,
            },
        }
    }

    /// Create a file content part.
    pub fn file(source: impl Into<String>, media_type: Option<String>) -> Self {
        Self {
            kind: ContentPartKind::FilePart {
                source: source.into(),
                media_type,
            },
        }
    }

    /// Create an audio content part.
    pub fn audio(source: impl Into<String>, media_type: Option<String>) -> Self {
        Self {
            kind: ContentPartKind::AudioPart {
                source: source.into(),
                media_type,
            },
        }
    }
}

// ---------------------------------------------------------------------------
// Eq for ContentPartKind, ContentPart (PartialEq is derived on the generated types)
// ---------------------------------------------------------------------------

impl Eq for ContentPartKind {}

impl Eq for ContentPart {}

// ---------------------------------------------------------------------------
// Message convenience methods
// ---------------------------------------------------------------------------

impl Message {
    /// Create a message with a single text part for any role.
    pub fn with_text(role: Role, content: impl Into<String>) -> Self {
        Self {
            role,
            parts: vec![ContentPart::text(content)],
            metadata: serde_json::Value::Object(serde_json::Map::new()),
        }
    }

    /// Create a tool-result message.
    pub fn tool_result(tool_call_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: Role::Tool,
            parts: vec![ContentPart::text(content)],
            metadata: serde_json::json!({"tool_call_id": tool_call_id.into()}),
        }
    }

    /// Concatenate all text parts into a single string (no separator).
    pub fn text_content(&self) -> String {
        self.parts
            .iter()
            .filter_map(|p| match &p.kind {
                ContentPartKind::TextPart { value } => Some(value.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("")
    }

    /// True if this message has any non-text content parts.
    pub fn has_rich_content(&self) -> bool {
        self.parts
            .iter()
            .any(|p| !matches!(&p.kind, ContentPartKind::TextPart { .. }))
    }

    /// Get a mutable reference to the metadata map.
    /// If metadata is not an Object, replaces it with an empty Object first.
    pub fn metadata_mut(&mut self) -> &mut serde_json::Map<String, serde_json::Value> {
        if !self.metadata.is_object() {
            self.metadata = serde_json::Value::Object(serde_json::Map::new());
        }
        self.metadata.as_object_mut().unwrap()
    }
}

// ---------------------------------------------------------------------------
// Role — case-insensitive from_str helper for backward compat
// ---------------------------------------------------------------------------

impl Role {
    /// Parse a role string case-insensitively. Returns `None` for unrecognised values.
    pub fn from_str_ignore_case(s: &str) -> Option<Self> {
        Self::from_str_opt(s.to_lowercase().as_str())
    }
}
