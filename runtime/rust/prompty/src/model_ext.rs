//! Extension methods for generated model types.
//!
//! The TypeSpec emitter generates the model structs in `model/`. This module
//! adds convenience accessors used by the pipeline and other hand-written code.

use crate::model::{Property, Prompty, Tool};

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
