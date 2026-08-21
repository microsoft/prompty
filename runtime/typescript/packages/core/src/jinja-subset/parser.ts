import type { Branch, Expr, Node, PathSeg } from "./ast.js";
import { TemplateSyntaxError } from "./errors.js";
import { type Token, tokenize } from "./tokenizer.js";

type ETokKind = "string" | "number" | "op" | "keyword" | "name";
interface ETok {
  kind: ETokKind;
  value: string | number;
}

const TWO_CHAR_OPS = new Set(["==", "!=", "<=", ">="]);
const ONE_CHAR_OPS = new Set("()[].,|<>");
const KEYWORDS = new Set(["and", "or", "not", "in", "true", "false", "null"]);

export function parseTemplate(template: string): Node[] {
  return new TemplateParser(tokenize(template)).parse();
}

function lexExpr(src: string): ETok[] {
  const toks: ETok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      i += 1;
      let value = "";
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < src.length) {
          value += src[i + 1];
          i += 2;
        } else {
          value += src[i];
          i += 1;
        }
      }
      if (i >= src.length)
        throw new TemplateSyntaxError(
          `Unterminated string in expression: ${src}`,
        );
      i += 1;
      toks.push({ kind: "string", value });
      continue;
    }

    if (
      /\d/.test(c) ||
      (c === "-" && i + 1 < src.length && /\d/.test(src[i + 1]))
    ) {
      let j = i + 1;
      while (j < src.length && /[\d.]/.test(src[j])) j += 1;
      toks.push({ kind: "number", value: Number(src.slice(i, j)) });
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      const word = src.slice(i, j);
      toks.push({ kind: KEYWORDS.has(word) ? "keyword" : "name", value: word });
      i = j;
      continue;
    }

    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      toks.push({ kind: "op", value: two });
      i += 2;
      continue;
    }

    if (ONE_CHAR_OPS.has(c)) {
      toks.push({ kind: "op", value: c });
      i += 1;
      continue;
    }

    throw new TemplateSyntaxError(
      `Unexpected character '${c}' in expression: ${src}`,
    );
  }
  return toks;
}

class ExprParser {
  private pos = 0;

  constructor(
    private readonly toks: ETok[],
    private readonly src: string,
  ) {}

  parse(): Expr {
    const expr = this.parseOr();
    if (this.pos !== this.toks.length) {
      throw new TemplateSyntaxError(
        `Trailing tokens in expression: ${this.src}`,
      );
    }
    return expr;
  }

  private peek(): ETok | undefined {
    return this.toks[this.pos];
  }

  private next(): ETok {
    const tok = this.toks[this.pos];
    this.pos += 1;
    return tok;
  }

  private is(kind: ETokKind, value: string): boolean {
    const tok = this.peek();
    return tok?.kind === kind && tok.value === value;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.is("keyword", "or")) {
      this.next();
      left = { kind: "binary", operator: "or", left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.is("keyword", "and")) {
      this.next();
      left = { kind: "binary", operator: "and", left, right: this.parseNot() };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.is("keyword", "not")) {
      this.next();
      return { kind: "unary", operator: "not", operand: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    const left = this.parseFilter();
    const tok = this.peek();
    if (
      tok?.kind === "op" &&
      typeof tok.value === "string" &&
      ["==", "!=", "<", ">", "<=", ">="].includes(tok.value)
    ) {
      this.next();
      return {
        kind: "binary",
        operator: tok.value,
        left,
        right: this.parseFilter(),
      };
    }
    if (this.is("keyword", "in")) {
      this.next();
      return {
        kind: "binary",
        operator: "in",
        left,
        right: this.parseFilter(),
      };
    }
    return left;
  }

  private parseFilter(): Expr {
    let expr = this.parsePrimary();
    while (this.is("op", "|")) {
      this.next();
      const nameTok = this.peek();
      if (nameTok?.kind !== "name" || typeof nameTok.value !== "string") {
        throw new TemplateSyntaxError(`Expected filter name in: ${this.src}`);
      }
      const name = this.next().value as string;
      const args: Expr[] = [];
      if (this.is("op", "(")) {
        this.next();
        if (!this.is("op", ")")) {
          args.push(this.parseOr());
          while (this.is("op", ",")) {
            this.next();
            args.push(this.parseOr());
          }
        }
        if (!this.is("op", ")"))
          throw new TemplateSyntaxError(`Unclosed filter args in: ${this.src}`);
        this.next();
      }
      expr = { kind: "filter", name, input: expr, args };
    }
    return expr;
  }

  private parsePrimary(): Expr {
    const tok = this.peek();
    if (!tok)
      throw new TemplateSyntaxError(
        `Unexpected end of expression: ${this.src}`,
      );
    if (tok.kind === "op" && tok.value === "(") {
      this.next();
      const expr = this.parseOr();
      if (!this.is("op", ")"))
        throw new TemplateSyntaxError(`Unclosed parenthesis in: ${this.src}`);
      this.next();
      return expr;
    }
    if (tok.kind === "string") {
      this.next();
      return { kind: "lit", value: tok.value };
    }
    if (tok.kind === "number") {
      this.next();
      return { kind: "lit", value: tok.value };
    }
    if (
      tok.kind === "keyword" &&
      ["true", "false", "null"].includes(String(tok.value))
    ) {
      this.next();
      return {
        kind: "lit",
        value:
          tok.value === "true" ? true : tok.value === "false" ? false : null,
      };
    }
    if (tok.kind === "name") return this.parseAccessor();
    throw new TemplateSyntaxError(
      `Unexpected token '${String(tok.value)}' in expression: ${this.src}`,
    );
  }

  private parseAccessor(): Expr {
    const root = this.next().value as string;
    const path: PathSeg[] = [];
    while (true) {
      if (this.is("op", ".")) {
        this.next();
        const attrTok = this.peek();
        if (
          !attrTok ||
          (attrTok.kind !== "name" && attrTok.kind !== "keyword") ||
          typeof attrTok.value !== "string"
        ) {
          throw new TemplateSyntaxError(
            `Expected attribute name in: ${this.src}`,
          );
        }
        path.push({ kind: "attr", name: this.next().value as string });
      } else if (this.is("op", "[")) {
        this.next();
        const expr = this.parseOr();
        if (!this.is("op", "]"))
          throw new TemplateSyntaxError(`Unclosed index in: ${this.src}`);
        this.next();
        path.push({ kind: "index", expr });
      } else {
        break;
      }
    }
    return { kind: "var", root, path };
  }
}

export function parseExpression(src: string): Expr {
  return new ExprParser(lexExpr(src), src).parse();
}

function stmtHead(inner: string): { head: string; rest: string } {
  const trimmed = inner.trim();
  if (!trimmed) return { head: "", rest: "" };
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  return { head: match?.[1] ?? "", rest: match?.[2] ?? "" };
}

class TemplateParser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Node[] {
    return this.parseNodes([]);
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private parseNodes(terminators: string[]): Node[] {
    const nodes: Node[] = [];
    while (this.pos < this.tokens.length) {
      const tok = this.tokens[this.pos];
      if (tok.type === "stmt") {
        const { head } = stmtHead(tok.value);
        if (terminators.includes(head)) return nodes;
        if (head === "if") {
          nodes.push(this.parseIf());
          continue;
        }
        if (head === "for") {
          nodes.push(this.parseFor());
          continue;
        }
        throw new TemplateSyntaxError(`Unexpected statement '${tok.value}'`);
      }
      if (tok.type === "text") {
        this.pos += 1;
        nodes.push({ kind: "text", value: tok.value });
        continue;
      }
      if (tok.type === "expr") {
        this.pos += 1;
        nodes.push({ kind: "interp", expr: parseExpression(tok.value) });
        continue;
      }
      throw new TemplateSyntaxError(`Unexpected token type ${tok.type}`);
    }
    if (terminators.length > 0) {
      throw new TemplateSyntaxError(
        `Unclosed block; expected one of ${terminators.join(", ")}`,
      );
    }
    return nodes;
  }

  private parseIf(): Node {
    const branches: Branch[] = [];
    const { rest } = stmtHead(this.tokens[this.pos].value);
    this.pos += 1;
    branches.push({
      test: parseExpression(rest),
      body: this.parseNodes(["elif", "else", "endif"]),
    });
    let elseBody: Node[] | undefined;

    while (true) {
      const tok = this.peek();
      if (!tok) throw new TemplateSyntaxError("Unclosed 'if' block");
      const { head, rest: branchRest } = stmtHead(tok.value);
      if (head === "elif") {
        this.pos += 1;
        branches.push({
          test: parseExpression(branchRest),
          body: this.parseNodes(["elif", "else", "endif"]),
        });
        continue;
      }
      if (head === "else") {
        this.pos += 1;
        elseBody = this.parseNodes(["endif"]);
        continue;
      }
      if (head === "endif") {
        this.pos += 1;
        break;
      }
      throw new TemplateSyntaxError(`Unexpected '${tok.value}' in if block`);
    }
    return { kind: "if", branches, elseBody };
  }

  private parseFor(): Node {
    const { rest } = stmtHead(this.tokens[this.pos].value);
    this.pos += 1;
    const parts = /^(\S+)\s+in\s+([\s\S]+)$/.exec(rest);
    if (!parts)
      throw new TemplateSyntaxError(`Malformed for statement: 'for ${rest}'`);
    const body = this.parseNodes(["endfor"]);
    const endfor = this.peek();
    if (!endfor || stmtHead(endfor.value).head !== "endfor") {
      throw new TemplateSyntaxError("Unclosed 'for' block");
    }
    this.pos += 1;
    return {
      kind: "for",
      loopVar: parts[1],
      seq: parseExpression(parts[2]),
      body,
    };
  }
}
