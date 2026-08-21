"""Prompty Jinja Subset — reference parser.

Turns the token stream from :mod:`.tokenizer` into the parse AST defined in
``spec/jinja-grammar.md`` §4 and mirrored in
``schema/model/conformance/ast-model.tsp``. Nodes and expressions are plain
dicts with a ``kind`` discriminator so they serialize directly to the AST
golden JSON.

Includes a small expression sub-lexer and a recursive-descent expression parser
implementing the §3 grammar (no arithmetic).
"""

from __future__ import annotations

from .tokenizer import TemplateSyntaxError, Token, tokenize

__all__ = ["parse_template"]

# --- Expression lexer -------------------------------------------------------

_TWO_CHAR_OPS = ("==", "!=", "<=", ">=")
_ONE_CHAR_OPS = set("()[].,|<>")
_KEYWORDS = {"and", "or", "not", "in", "true", "false", "null"}


class _ETok:
    """An expression token: ``kind`` in name/string/number/op/keyword."""

    __slots__ = ("kind", "value")

    def __init__(self, kind: str, value: object) -> None:
        self.kind = kind
        self.value = value

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return f"_ETok({self.kind!r}, {self.value!r})"


def _lex_expr(src: str) -> list[_ETok]:
    toks: list[_ETok] = []
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        if c in " \t\r\n":
            i += 1
            continue
        if c in "\"'":
            quote = c
            i += 1
            buf: list[str] = []
            while i < n and src[i] != quote:
                if src[i] == "\\" and i + 1 < n:
                    buf.append(src[i + 1])
                    i += 2
                    continue
                buf.append(src[i])
                i += 1
            if i >= n:
                raise TemplateSyntaxError(f"Unterminated string in expression: {src!r}")
            i += 1  # closing quote
            toks.append(_ETok("string", "".join(buf)))
            continue
        if c.isdigit() or (c == "-" and i + 1 < n and src[i + 1].isdigit()):
            j = i + 1
            while j < n and (src[j].isdigit() or src[j] == "."):
                j += 1
            num = src[i:j]
            toks.append(_ETok("number", float(num) if "." in num else int(num)))
            i = j
            continue
        if c.isalpha() or c == "_":
            j = i + 1
            while j < n and (src[j].isalnum() or src[j] == "_"):
                j += 1
            word = src[i:j]
            toks.append(_ETok("keyword" if word in _KEYWORDS else "name", word))
            i = j
            continue
        two = src[i : i + 2]
        if two in _TWO_CHAR_OPS:
            toks.append(_ETok("op", two))
            i += 2
            continue
        if c in _ONE_CHAR_OPS:
            toks.append(_ETok("op", c))
            i += 1
            continue
        raise TemplateSyntaxError(f"Unexpected character {c!r} in expression: {src!r}")
    return toks


# --- Expression parser (recursive descent) ----------------------------------


class _ExprParser:
    def __init__(self, toks: list[_ETok], src: str) -> None:
        self.toks = toks
        self.src = src
        self.pos = 0

    def _peek(self) -> _ETok | None:
        return self.toks[self.pos] if self.pos < len(self.toks) else None

    def _next(self) -> _ETok:
        tok = self.toks[self.pos]
        self.pos += 1
        return tok

    def _is(self, kind: str, value: object) -> bool:
        t = self._peek()
        return t is not None and t.kind == kind and t.value == value

    def parse(self) -> dict:
        expr = self._parse_or()
        if self.pos != len(self.toks):
            raise TemplateSyntaxError(f"Trailing tokens in expression: {self.src!r}")
        return expr

    def _parse_or(self) -> dict:
        left = self._parse_and()
        while self._is("keyword", "or"):
            self._next()
            right = self._parse_and()
            left = {"kind": "binary", "operator": "or", "left": left, "right": right}
        return left

    def _parse_and(self) -> dict:
        left = self._parse_not()
        while self._is("keyword", "and"):
            self._next()
            right = self._parse_not()
            left = {"kind": "binary", "operator": "and", "left": left, "right": right}
        return left

    def _parse_not(self) -> dict:
        if self._is("keyword", "not"):
            self._next()
            return {"kind": "unary", "operator": "not", "operand": self._parse_not()}
        return self._parse_comparison()

    def _parse_comparison(self) -> dict:
        left = self._parse_filter()
        t = self._peek()
        if t is not None and t.kind == "op" and t.value in ("==", "!=", "<", ">", "<=", ">="):
            op = self._next().value
            right = self._parse_filter()
            return {"kind": "binary", "operator": op, "left": left, "right": right}
        if self._is("keyword", "in"):
            self._next()
            right = self._parse_filter()
            return {"kind": "binary", "operator": "in", "left": left, "right": right}
        return left

    def _parse_filter(self) -> dict:
        expr = self._parse_primary()
        while self._is("op", "|"):
            self._next()
            name_tok = self._peek()
            if name_tok is None or name_tok.kind != "name":
                raise TemplateSyntaxError(f"Expected filter name in: {self.src!r}")
            name = self._next().value
            args: list[dict] = []
            if self._is("op", "("):
                self._next()
                if not self._is("op", ")"):
                    args.append(self._parse_or())
                    while self._is("op", ","):
                        self._next()
                        args.append(self._parse_or())
                if not self._is("op", ")"):
                    raise TemplateSyntaxError(f"Unclosed filter args in: {self.src!r}")
                self._next()
            expr = {"kind": "filter", "name": name, "input": expr, "args": args}
        return expr

    def _parse_primary(self) -> dict:
        t = self._peek()
        if t is None:
            raise TemplateSyntaxError(f"Unexpected end of expression: {self.src!r}")
        if t.kind == "op" and t.value == "(":
            self._next()
            expr = self._parse_or()
            if not self._is("op", ")"):
                raise TemplateSyntaxError(f"Unclosed parenthesis in: {self.src!r}")
            self._next()
            return expr
        if t.kind == "string":
            self._next()
            return {"kind": "lit", "value": t.value}
        if t.kind == "number":
            self._next()
            return {"kind": "lit", "value": t.value}
        if t.kind == "keyword" and t.value in ("true", "false", "null"):
            self._next()
            value = {"true": True, "false": False, "null": None}[t.value]
            return {"kind": "lit", "value": value}
        if t.kind == "name":
            return self._parse_accessor()
        raise TemplateSyntaxError(f"Unexpected token {t.value!r} in expression: {self.src!r}")

    def _parse_accessor(self) -> dict:
        root = self._next().value
        path: list[dict] = []
        while True:
            if self._is("op", "."):
                self._next()
                attr_tok = self._peek()
                if attr_tok is None or attr_tok.kind not in ("name", "keyword"):
                    raise TemplateSyntaxError(f"Expected attribute name in: {self.src!r}")
                path.append({"kind": "attr", "name": self._next().value})
            elif self._is("op", "["):
                self._next()
                index_expr = self._parse_or()
                if not self._is("op", "]"):
                    raise TemplateSyntaxError(f"Unclosed index in: {self.src!r}")
                self._next()
                path.append({"kind": "index", "expr": index_expr})
            else:
                break
        return {"kind": "var", "root": root, "path": path}


def _parse_expression(src: str) -> dict:
    return _ExprParser(_lex_expr(src), src).parse()


# --- Template / statement parser --------------------------------------------


def _stmt_head(inner: str) -> tuple[str, str]:
    """Split a statement into its leading keyword and the remainder."""
    parts = inner.split(None, 1)
    head = parts[0] if parts else ""
    rest = parts[1] if len(parts) > 1 else ""
    return head, rest


class _TemplateParser:
    def __init__(self, tokens: list[Token]) -> None:
        self.tokens = tokens
        self.pos = 0

    def _peek(self) -> Token | None:
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def parse(self) -> dict:
        nodes = self._parse_nodes(terminators=())
        return {"nodes": nodes}

    def _parse_nodes(self, terminators: tuple[str, ...]) -> list[dict]:
        nodes: list[dict] = []
        while self.pos < len(self.tokens):
            tok = self.tokens[self.pos]
            if tok.type == "stmt":
                head, _ = _stmt_head(tok.value)
                if head in terminators:
                    return nodes
                if head == "if":
                    nodes.append(self._parse_if())
                    continue
                if head == "for":
                    nodes.append(self._parse_for())
                    continue
                raise TemplateSyntaxError(f"Unexpected statement '{tok.value}'")
            if tok.type == "text":
                self.pos += 1
                nodes.append({"kind": "text", "value": tok.value})
                continue
            if tok.type == "expr":
                self.pos += 1
                nodes.append({"kind": "interp", "expr": _parse_expression(tok.value)})
                continue
            raise TemplateSyntaxError(f"Unexpected token type {tok.type!r}")
        if terminators:
            raise TemplateSyntaxError(f"Unclosed block; expected one of {terminators}")
        return nodes

    def _parse_if(self) -> dict:
        branches: list[dict] = []
        _, rest = _stmt_head(self.tokens[self.pos].value)
        self.pos += 1
        branches.append({"test": _parse_expression(rest), "body": self._parse_nodes(("elif", "else", "endif"))})
        else_body: list[dict] | None = None
        while True:
            tok = self._peek()
            if tok is None:
                raise TemplateSyntaxError("Unclosed 'if' block")
            head, rest = _stmt_head(tok.value)
            if head == "elif":
                self.pos += 1
                branches.append({"test": _parse_expression(rest), "body": self._parse_nodes(("elif", "else", "endif"))})
                continue
            if head == "else":
                self.pos += 1
                else_body = self._parse_nodes(("endif",))
                continue
            if head == "endif":
                self.pos += 1
                break
            raise TemplateSyntaxError(f"Unexpected '{tok.value}' in if block")
        node: dict = {"kind": "if", "branches": branches}
        if else_body is not None:
            node["elseBody"] = else_body
        return node

    def _parse_for(self) -> dict:
        _, rest = _stmt_head(self.tokens[self.pos].value)
        self.pos += 1
        # rest looks like: "item in items"
        parts = rest.split(None, 2)
        if len(parts) < 3 or parts[1] != "in":
            raise TemplateSyntaxError(f"Malformed for statement: 'for {rest}'")
        loop_var = parts[0]
        seq_expr = _parse_expression(parts[2])
        body = self._parse_nodes(("endfor",))
        endfor = self._peek()
        if endfor is None or _stmt_head(endfor.value)[0] != "endfor":
            raise TemplateSyntaxError("Unclosed 'for' block")
        self.pos += 1
        return {"kind": "for", "loopVar": loop_var, "seq": seq_expr, "body": body}


def parse_template(template: str) -> dict:
    """Parse ``template`` into the segment-tree parse AST (a ``Template`` dict)."""
    return _TemplateParser(tokenize(template)).parse()
