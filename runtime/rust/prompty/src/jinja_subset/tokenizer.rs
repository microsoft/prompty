//! Lexical scanner: splits a raw template into literal text and tag regions
//! (`{{ }}` expressions, `{% %}` statements, `{# #}` comments), applying the
//! `{%- … -%}` / `{{- … -}}` whitespace-trim markers. Ported from the reference
//! tokenizer; comments carry trim semantics but produce no node.

use super::RenderError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TokenType {
    Text,
    Expr,
    Stmt,
    Comment,
}

#[derive(Debug, Clone)]
pub(crate) struct Token {
    pub ty: TokenType,
    pub value: String,
    pub trim_left: bool,
    pub trim_right: bool,
}

/// Find `needle` in `haystack` at or after `start`, returning the char index.
fn find_sub(haystack: &[char], needle: &[char], start: usize) -> Option<usize> {
    if needle.is_empty() || start + needle.len() > haystack.len() {
        return None;
    }
    let last = haystack.len() - needle.len();
    (start..=last).find(|&i| &haystack[i..i + needle.len()] == needle)
}

/// Tokenize `template` into a flat stream of text and tag tokens, with comment
/// tokens removed after trim application.
pub(crate) fn tokenize(template: &str) -> Result<Vec<Token>, RenderError> {
    // Work over chars so multi-byte content never splits a UTF-8 boundary; the
    // delimiters themselves are ASCII.
    let chars: Vec<char> = template.chars().collect();
    let n = chars.len();
    let openers: [(&str, TokenType, &str); 3] = [
        ("{{", TokenType::Expr, "}}"),
        ("{%", TokenType::Stmt, "%}"),
        ("{#", TokenType::Comment, "#}"),
    ];

    let mut raw: Vec<Token> = Vec::new();
    let mut i = 0usize;
    let mut text_start = 0usize;

    while i < n {
        let two: String = if i + 2 <= n {
            chars[i..i + 2].iter().collect()
        } else {
            String::new()
        };

        if let Some(&(open, kind, close)) = openers.iter().find(|(o, _, _)| *o == two) {
            if i > text_start {
                raw.push(Token {
                    ty: TokenType::Text,
                    value: chars[text_start..i].iter().collect(),
                    trim_left: false,
                    trim_right: false,
                });
            }

            let close_chars: Vec<char> = close.chars().collect();
            let close_idx = match find_sub(&chars, &close_chars, i + 2) {
                Some(idx) => idx,
                None => {
                    return Err(RenderError::Syntax(format!(
                        "Unclosed '{open}' tag at offset {i}"
                    )));
                }
            };

            let mut inner: String = chars[i + 2..close_idx].iter().collect();
            let trim_left = inner.starts_with('-');
            let trim_right = inner.ends_with('-');
            if trim_left {
                inner = inner[1..].to_string();
            }
            if trim_right {
                inner = inner[..inner.len() - 1].to_string();
            }

            if kind == TokenType::Comment {
                // No node, but the trim markers still apply to neighbours.
                raw.push(Token {
                    ty: TokenType::Comment,
                    value: String::new(),
                    trim_left,
                    trim_right,
                });
            } else {
                raw.push(Token {
                    ty: kind,
                    value: inner.trim().to_string(),
                    trim_left,
                    trim_right,
                });
            }

            i = close_idx + close_chars.len();
            text_start = i;
        } else {
            i += 1;
        }
    }

    if text_start < n {
        raw.push(Token {
            ty: TokenType::Text,
            value: chars[text_start..].iter().collect(),
            trim_left: false,
            trim_right: false,
        });
    }

    apply_trims(&mut raw);
    Ok(raw
        .into_iter()
        .filter(|t| t.ty != TokenType::Comment)
        .collect())
}

/// Apply `{%- -%}`/`{{- -}}` trim markers: a tag with `trim_left` trims the
/// trailing whitespace of the preceding text token; `trim_right` trims the
/// leading whitespace of the following text token.
fn apply_trims(tokens: &mut [Token]) {
    for idx in 0..tokens.len() {
        if tokens[idx].ty == TokenType::Text {
            continue;
        }
        let (trim_left, trim_right) = (tokens[idx].trim_left, tokens[idx].trim_right);
        if trim_left && idx > 0 && tokens[idx - 1].ty == TokenType::Text {
            let trimmed = tokens[idx - 1].value.trim_end().to_string();
            tokens[idx - 1].value = trimmed;
        }
        if trim_right && idx + 1 < tokens.len() && tokens[idx + 1].ty == TokenType::Text {
            let trimmed = tokens[idx + 1].value.trim_start().to_string();
            tokens[idx + 1].value = trimmed;
        }
    }
}
