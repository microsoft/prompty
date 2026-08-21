//! Recursive-descent parser for the Jinja subset: an expression lexer + Pratt-free
//! precedence-climbing expression parser (`or > and > not > comparison > filter >
//! primary > accessor`) and a template parser that assembles text/interp/if/for
//! nodes. No arithmetic operators exist in the subset; `-` only introduces a
//! negative numeric literal. Ported from the reference parser.

use serde_json::Value;

use super::RenderError;
use super::tokenizer::{Token, TokenType, tokenize};

/// A parsed expression node.
#[derive(Debug, Clone)]
pub(crate) enum Expr {
    /// A literal value (string, number, bool, null).
    Lit(Value),
    /// A variable reference: a root name plus a chain of attribute/index accesses.
    Var { root: String, path: Vec<PathSeg> },
    /// `input | name(args...)`.
    Filter {
        name: String,
        input: Box<Expr>,
        args: Vec<Expr>,
    },
    /// `not operand`.
    Not(Box<Expr>),
    /// A binary operator: `and`, `or`, or a comparison (`== != < > <= >= in`).
    Binary {
        op: String,
        left: Box<Expr>,
        right: Box<Expr>,
    },
}

/// A single access step in a variable reference.
#[derive(Debug, Clone)]
pub(crate) enum PathSeg {
    Attr(String),
    Index(Box<Expr>),
}

/// A parsed template node.
#[derive(Debug, Clone)]
pub(crate) enum Node {
    Text(String),
    Interp(Expr),
    If {
        branches: Vec<(Expr, Vec<Node>)>,
        else_body: Option<Vec<Node>>,
    },
    For {
        loop_var: String,
        seq: Expr,
        body: Vec<Node>,
    },
}

// ---------------------------------------------------------------------------
// Expression lexer
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
enum ETok {
    Str(String),
    Num(Value),
    Op(String),
    Keyword(String),
    Name(String),
}

const KEYWORDS: [&str; 6] = ["and", "or", "not", "in", "true", "false"];

fn is_ident_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_'
}

fn is_ident_part(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

fn lex_expr(src: &str) -> Result<Vec<ETok>, RenderError> {
    let chars: Vec<char> = src.chars().collect();
    let n = chars.len();
    let mut toks: Vec<ETok> = Vec::new();
    let mut i = 0usize;

    while i < n {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }

        // String literal (single or double quote) with backslash escapes.
        if c == '\'' || c == '"' {
            let quote = c;
            i += 1;
            let mut s = String::new();
            let mut closed = false;
            while i < n {
                let d = chars[i];
                if d == '\\' && i + 1 < n {
                    let e = chars[i + 1];
                    let mapped = match e {
                        'n' => '\n',
                        't' => '\t',
                        'r' => '\r',
                        '\\' => '\\',
                        '\'' => '\'',
                        '"' => '"',
                        other => other,
                    };
                    s.push(mapped);
                    i += 2;
                    continue;
                }
                if d == quote {
                    closed = true;
                    i += 1;
                    break;
                }
                s.push(d);
                i += 1;
            }
            if !closed {
                return Err(RenderError::Syntax(format!(
                    "Unterminated string literal: {src}"
                )));
            }
            toks.push(ETok::Str(s));
            continue;
        }

        // Number literal, including a leading-minus negative.
        if c.is_ascii_digit() || (c == '-' && i + 1 < n && chars[i + 1].is_ascii_digit()) {
            let start = i;
            if c == '-' {
                i += 1;
            }
            let mut has_dot = false;
            while i < n && (chars[i].is_ascii_digit() || (chars[i] == '.' && !has_dot)) {
                if chars[i] == '.' {
                    has_dot = true;
                }
                i += 1;
            }
            let text: String = chars[start..i].iter().collect();
            let value = if has_dot {
                match text.parse::<f64>() {
                    Ok(f) => Value::from(f),
                    Err(_) => return Err(RenderError::Syntax(format!("Invalid number: {text}"))),
                }
            } else {
                match text.parse::<i64>() {
                    Ok(n) => Value::from(n),
                    Err(_) => return Err(RenderError::Syntax(format!("Invalid number: {text}"))),
                }
            };
            toks.push(ETok::Num(value));
            continue;
        }

        // Identifier / keyword.
        if is_ident_start(c) {
            let start = i;
            while i < n && is_ident_part(chars[i]) {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            if word == "null" || word == "none" || word == "None" {
                toks.push(ETok::Keyword("null".to_string()));
            } else if KEYWORDS.contains(&word.as_str()) {
                toks.push(ETok::Keyword(word));
            } else {
                toks.push(ETok::Name(word));
            }
            continue;
        }

        // Two-char operators.
        if i + 1 < n {
            let two: String = chars[i..i + 2].iter().collect();
            if matches!(two.as_str(), "==" | "!=" | "<=" | ">=") {
                toks.push(ETok::Op(two));
                i += 2;
                continue;
            }
        }

        // Single-char operators.
        if matches!(c, '(' | ')' | '[' | ']' | '.' | ',' | '|' | '<' | '>') {
            toks.push(ETok::Op(c.to_string()));
            i += 1;
            continue;
        }

        return Err(RenderError::Syntax(format!(
            "Unexpected character '{c}' in expression: {src}"
        )));
    }

    Ok(toks)
}

// ---------------------------------------------------------------------------
// Expression parser
// ---------------------------------------------------------------------------

struct ExprParser {
    toks: Vec<ETok>,
    pos: usize,
}

impl ExprParser {
    fn new(toks: Vec<ETok>) -> Self {
        Self { toks, pos: 0 }
    }

    fn peek(&self) -> Option<&ETok> {
        self.toks.get(self.pos)
    }

    fn next(&mut self) -> Option<ETok> {
        let t = self.toks.get(self.pos).cloned();
        if t.is_some() {
            self.pos += 1;
        }
        t
    }

    fn at_op(&self, op: &str) -> bool {
        matches!(self.peek(), Some(ETok::Op(o)) if o == op)
    }

    fn at_keyword(&self, kw: &str) -> bool {
        matches!(self.peek(), Some(ETok::Keyword(k)) if k == kw)
    }

    fn expect_op(&mut self, op: &str) -> Result<(), RenderError> {
        if self.at_op(op) {
            self.pos += 1;
            Ok(())
        } else {
            Err(RenderError::Syntax(format!(
                "Expected '{op}' in expression"
            )))
        }
    }

    fn parse(&mut self) -> Result<Expr, RenderError> {
        let expr = self.parse_or()?;
        if self.pos != self.toks.len() {
            return Err(RenderError::Syntax(
                "Trailing tokens in expression".to_string(),
            ));
        }
        Ok(expr)
    }

    fn parse_or(&mut self) -> Result<Expr, RenderError> {
        let mut left = self.parse_and()?;
        while self.at_keyword("or") {
            self.pos += 1;
            let right = self.parse_and()?;
            left = Expr::Binary {
                op: "or".to_string(),
                left: Box::new(left),
                right: Box::new(right),
            };
        }
        Ok(left)
    }

    fn parse_and(&mut self) -> Result<Expr, RenderError> {
        let mut left = self.parse_not()?;
        while self.at_keyword("and") {
            self.pos += 1;
            let right = self.parse_not()?;
            left = Expr::Binary {
                op: "and".to_string(),
                left: Box::new(left),
                right: Box::new(right),
            };
        }
        Ok(left)
    }

    fn parse_not(&mut self) -> Result<Expr, RenderError> {
        if self.at_keyword("not") {
            self.pos += 1;
            let operand = self.parse_not()?;
            return Ok(Expr::Not(Box::new(operand)));
        }
        self.parse_comparison()
    }

    fn parse_comparison(&mut self) -> Result<Expr, RenderError> {
        let left = self.parse_filter()?;
        let op = match self.peek() {
            Some(ETok::Op(o)) if matches!(o.as_str(), "==" | "!=" | "<" | ">" | "<=" | ">=") => {
                Some(o.clone())
            }
            Some(ETok::Keyword(k)) if k == "in" => Some("in".to_string()),
            _ => None,
        };
        if let Some(op) = op {
            self.pos += 1;
            let right = self.parse_filter()?;
            return Ok(Expr::Binary {
                op,
                left: Box::new(left),
                right: Box::new(right),
            });
        }
        Ok(left)
    }

    fn parse_filter(&mut self) -> Result<Expr, RenderError> {
        let mut expr = self.parse_primary()?;
        while self.at_op("|") {
            self.pos += 1;
            let name = match self.next() {
                Some(ETok::Name(n)) => n,
                _ => {
                    return Err(RenderError::Syntax(
                        "Expected filter name after '|'".to_string(),
                    ));
                }
            };
            let mut args: Vec<Expr> = Vec::new();
            if self.at_op("(") {
                self.pos += 1;
                if !self.at_op(")") {
                    loop {
                        args.push(self.parse_or()?);
                        if self.at_op(",") {
                            self.pos += 1;
                            continue;
                        }
                        break;
                    }
                }
                self.expect_op(")")?;
            }
            expr = Expr::Filter {
                name,
                input: Box::new(expr),
                args,
            };
        }
        Ok(expr)
    }

    fn parse_primary(&mut self) -> Result<Expr, RenderError> {
        match self.peek().cloned() {
            Some(ETok::Str(s)) => {
                self.pos += 1;
                Ok(Expr::Lit(Value::String(s)))
            }
            Some(ETok::Num(v)) => {
                self.pos += 1;
                Ok(Expr::Lit(v))
            }
            Some(ETok::Keyword(k)) if k == "true" => {
                self.pos += 1;
                Ok(Expr::Lit(Value::Bool(true)))
            }
            Some(ETok::Keyword(k)) if k == "false" => {
                self.pos += 1;
                Ok(Expr::Lit(Value::Bool(false)))
            }
            Some(ETok::Keyword(k)) if k == "null" => {
                self.pos += 1;
                Ok(Expr::Lit(Value::Null))
            }
            Some(ETok::Op(o)) if o == "(" => {
                self.pos += 1;
                let expr = self.parse_or()?;
                self.expect_op(")")?;
                Ok(expr)
            }
            Some(ETok::Name(name)) => {
                self.pos += 1;
                self.parse_accessor(name)
            }
            other => Err(RenderError::Syntax(format!(
                "Unexpected token in expression: {other:?}"
            ))),
        }
    }

    fn parse_accessor(&mut self, root: String) -> Result<Expr, RenderError> {
        let mut path: Vec<PathSeg> = Vec::new();
        loop {
            if self.at_op(".") {
                self.pos += 1;
                match self.next() {
                    Some(ETok::Name(n)) => path.push(PathSeg::Attr(n)),
                    // Allow keyword-like attribute names (e.g. `.index`).
                    Some(ETok::Keyword(k)) => path.push(PathSeg::Attr(k)),
                    _ => {
                        return Err(RenderError::Syntax(
                            "Expected attribute name after '.'".to_string(),
                        ));
                    }
                }
            } else if self.at_op("[") {
                self.pos += 1;
                let index = self.parse_or()?;
                self.expect_op("]")?;
                path.push(PathSeg::Index(Box::new(index)));
            } else {
                break;
            }
        }
        Ok(Expr::Var { root, path })
    }
}

fn parse_expression(src: &str) -> Result<Expr, RenderError> {
    let toks = lex_expr(src)?;
    if toks.is_empty() {
        return Err(RenderError::Syntax("Empty expression".to_string()));
    }
    ExprParser::new(toks).parse()
}

// ---------------------------------------------------------------------------
// Template parser
// ---------------------------------------------------------------------------

struct TemplateParser {
    tokens: Vec<Token>,
    pos: usize,
}

/// Split a statement body into its head keyword and the remaining text.
fn split_head(stmt: &str) -> (String, String) {
    let trimmed = stmt.trim();
    match trimmed.find(char::is_whitespace) {
        Some(idx) => (
            trimmed[..idx].to_string(),
            trimmed[idx..].trim().to_string(),
        ),
        None => (trimmed.to_string(), String::new()),
    }
}

impl TemplateParser {
    fn new(tokens: Vec<Token>) -> Self {
        Self { tokens, pos: 0 }
    }

    fn parse_nodes(
        &mut self,
        terminators: &[&str],
    ) -> Result<(Vec<Node>, Option<String>), RenderError> {
        let mut nodes: Vec<Node> = Vec::new();
        while self.pos < self.tokens.len() {
            let tok = self.tokens[self.pos].clone();
            match tok.ty {
                TokenType::Text => {
                    self.pos += 1;
                    nodes.push(Node::Text(tok.value));
                }
                TokenType::Expr => {
                    self.pos += 1;
                    nodes.push(Node::Interp(parse_expression(&tok.value)?));
                }
                TokenType::Stmt => {
                    let (head, rest) = split_head(&tok.value);
                    if terminators.contains(&head.as_str()) {
                        return Ok((nodes, Some(head)));
                    }
                    self.pos += 1;
                    match head.as_str() {
                        "if" => nodes.push(self.parse_if(&rest)?),
                        "for" => nodes.push(self.parse_for(&rest)?),
                        other => {
                            return Err(RenderError::Syntax(format!(
                                "Unknown statement '{other}'"
                            )));
                        }
                    }
                }
                TokenType::Comment => {
                    self.pos += 1;
                }
            }
        }
        Ok((nodes, None))
    }

    fn parse_if(&mut self, condition: &str) -> Result<Node, RenderError> {
        let mut branches: Vec<(Expr, Vec<Node>)> = Vec::new();
        let mut else_body: Option<Vec<Node>> = None;

        let mut current_cond = parse_expression(condition)?;
        loop {
            let (body, terminator) = self.parse_nodes(&["elif", "else", "endif"])?;
            branches.push((current_cond, body));
            match terminator.as_deref() {
                Some("elif") => {
                    let rest = self.consume_stmt_rest()?;
                    current_cond = parse_expression(&rest)?;
                }
                Some("else") => {
                    self.consume_stmt_rest()?;
                    let (else_nodes, term) = self.parse_nodes(&["endif"])?;
                    else_body = Some(else_nodes);
                    if term.as_deref() != Some("endif") {
                        return Err(RenderError::Syntax("Missing 'endif'".to_string()));
                    }
                    self.pos += 1;
                    break;
                }
                Some("endif") => {
                    self.pos += 1;
                    break;
                }
                _ => return Err(RenderError::Syntax("Missing 'endif'".to_string())),
            }
        }

        Ok(Node::If {
            branches,
            else_body,
        })
    }

    fn parse_for(&mut self, header: &str) -> Result<Node, RenderError> {
        // `<var> in <expr>`
        let idx = header
            .find(" in ")
            .ok_or_else(|| RenderError::Syntax(format!("Malformed for statement: {header}")))?;
        let loop_var = header[..idx].trim().to_string();
        let seq_src = header[idx + 4..].trim().to_string();
        if loop_var.is_empty() {
            return Err(RenderError::Syntax(format!(
                "Missing loop variable: {header}"
            )));
        }
        let seq = parse_expression(&seq_src)?;
        let (body, terminator) = self.parse_nodes(&["endfor"])?;
        if terminator.as_deref() != Some("endfor") {
            return Err(RenderError::Syntax("Missing 'endfor'".to_string()));
        }
        self.pos += 1;
        Ok(Node::For {
            loop_var,
            seq,
            body,
        })
    }

    /// Consume the statement token the parser is currently positioned on and
    /// return its tail (everything after the head keyword).
    fn consume_stmt_rest(&mut self) -> Result<String, RenderError> {
        let tok = self
            .tokens
            .get(self.pos)
            .cloned()
            .ok_or_else(|| RenderError::Syntax("Unexpected end of template".to_string()))?;
        self.pos += 1;
        let (_, rest) = split_head(&tok.value);
        Ok(rest)
    }
}

/// Tokenize and parse `template` into a node tree.
pub(crate) fn parse_template(template: &str) -> Result<Vec<Node>, RenderError> {
    let tokens = tokenize(template)?;
    let mut parser = TemplateParser::new(tokens);
    let (nodes, terminator) = parser.parse_nodes(&[])?;
    if let Some(t) = terminator {
        return Err(RenderError::Syntax(format!("Unexpected '{t}'")));
    }
    if parser.pos != parser.tokens.len() {
        return Err(RenderError::Syntax(
            "Unconsumed tokens after parse".to_string(),
        ));
    }
    Ok(nodes)
}
