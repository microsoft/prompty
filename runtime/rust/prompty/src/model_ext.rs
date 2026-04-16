//! Extension methods for generated model types.
//!
//! The TypeSpec emitter generates the model structs in `model/`. This module
//! adds convenience accessors used by the pipeline and other hand-written code.

use crate::model::{ContentPartKind, Message, MessageHelpers, Property, Prompty, Tool, ToolResult, ToolResultHelpers};

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
