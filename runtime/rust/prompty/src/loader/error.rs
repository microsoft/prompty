//! Error types for the Prompty loader.

use std::path::PathBuf;

/// Errors that can occur when loading a `.prompty` file.
#[derive(Debug)]
pub enum LoadError {
    /// The `.prompty` file was not found.
    FileNotFound(PathBuf, String),
    /// The YAML frontmatter is malformed.
    InvalidFrontmatter(String),
    /// A `${env:VAR}` reference could not be resolved.
    EnvVarNotSet {
        /// The variable name
        var_name: String,
        /// The key in the frontmatter where it was referenced
        key: String,
    },
    /// A `${file:path}` reference could not be resolved.
    FileReference {
        /// The referenced path
        path: PathBuf,
        /// Detail message
        detail: String,
    },
}

impl std::fmt::Display for LoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LoadError::FileNotFound(path, detail) => {
                write!(f, "File not found: {}: {}", path.display(), detail)
            }
            LoadError::InvalidFrontmatter(msg) => {
                write!(f, "Invalid frontmatter: {msg}")
            }
            LoadError::EnvVarNotSet { var_name, key } => {
                write!(
                    f,
                    "Environment variable '{var_name}' not set for key '{key}'"
                )
            }
            LoadError::FileReference { path, detail } => {
                write!(f, "File reference error: {}: {}", path.display(), detail)
            }
        }
    }
}

impl std::error::Error for LoadError {}
