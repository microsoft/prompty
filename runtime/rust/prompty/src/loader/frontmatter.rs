//! Frontmatter / body splitting for `.prompty` files.
//!
//! A `.prompty` file has YAML frontmatter delimited by `---` (or `+++`),
//! followed by a markdown body.

use super::error::LoadError;

/// Split a `.prompty` file into its frontmatter (as a JSON map) and body string.
///
/// Returns `(frontmatter_map, body)`. The body is the raw markdown after
/// the closing delimiter; it is NOT trimmed here (the caller trims).
pub fn split(raw: &str) -> Result<(serde_json::Map<String, serde_json::Value>, String), LoadError> {
    // Find opening delimiter (allow leading whitespace)
    let trimmed = raw.trim_start();

    if !trimmed.starts_with("---") && !trimmed.starts_with("+++") {
        // No delimiter at start → entire content is body, no frontmatter
        return Ok((serde_json::Map::new(), raw.to_string()));
    }

    let opener = &trimmed[..3];

    // Find the closing delimiter
    // Skip past the first line (the opening delimiter line)
    let after_opener = match trimmed[3..].find('\n') {
        Some(pos) => 3 + pos + 1,
        None => {
            // Only an opening delimiter, no newline — treat as empty frontmatter
            return Ok((serde_json::Map::new(), String::new()));
        }
    };

    // Search for closing delimiter (--- or +++)
    let rest = &trimmed[after_opener..];
    let close_pos = find_closing_delimiter(rest, opener);

    match close_pos {
        Some(pos) => {
            let yaml_str = &rest[..pos];
            // Body starts after the closing delimiter line
            let after_close = &rest[pos..];
            let body = match after_close.find('\n') {
                Some(nl) => &after_close[nl + 1..],
                None => "",
            };

            let frontmatter = parse_yaml(yaml_str)?;
            Ok((frontmatter, body.to_string()))
        }
        None => Err(LoadError::InvalidFrontmatter(
            "Opening delimiter without closing match".to_string(),
        )),
    }
}

/// Find the position of a closing delimiter (`---` or `+++`) that starts
/// at the beginning of a line.
fn find_closing_delimiter(text: &str, _opener: &str) -> Option<usize> {
    // The closing delimiter must be at the start of a line
    for (i, line) in text.split('\n').scan(0usize, |pos, line| {
        let start = *pos;
        *pos += line.len() + 1; // +1 for the \n
        Some((start, line))
    }) {
        let trimmed_line = line.trim();
        if trimmed_line == "---" || trimmed_line == "+++" {
            return Some(i);
        }
    }
    None
}

/// Parse YAML frontmatter string into a JSON map.
fn parse_yaml(yaml: &str) -> Result<serde_json::Map<String, serde_json::Value>, LoadError> {
    let trimmed = yaml.trim();
    if trimmed.is_empty() {
        return Ok(serde_json::Map::new());
    }

    let value: serde_json::Value =
        serde_yaml::from_str(trimmed).map_err(|e| LoadError::InvalidFrontmatter(e.to_string()))?;

    match value {
        serde_json::Value::Object(map) => Ok(map),
        _ => Err(LoadError::InvalidFrontmatter(
            "Frontmatter must be a YAML mapping".to_string(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_split() {
        let raw = "---\nname: test\n---\nHello world.";
        let (fm, body) = split(raw).unwrap();
        assert_eq!(fm["name"], "test");
        assert_eq!(body, "Hello world.");
    }

    #[test]
    fn test_no_frontmatter() {
        let raw = "Just a body with no frontmatter.";
        let (fm, body) = split(raw).unwrap();
        assert!(fm.is_empty());
        assert_eq!(body, raw);
    }

    #[test]
    fn test_empty_frontmatter() {
        let raw = "---\n---\nBody here.";
        let (fm, body) = split(raw).unwrap();
        assert!(fm.is_empty());
        assert_eq!(body, "Body here.");
    }

    #[test]
    fn test_missing_closing_delimiter() {
        let raw = "---\nname: test\nNo closing.";
        let result = split(raw);
        assert!(result.is_err());
    }

    #[test]
    fn test_multiline_body() {
        let raw = "---\nname: test\n---\nline1\nline2\nline3";
        let (fm, body) = split(raw).unwrap();
        assert_eq!(fm["name"], "test");
        assert_eq!(body, "line1\nline2\nline3");
    }
}
