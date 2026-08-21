// Copyright (c) Microsoft. All rights reserved.

using System.Globalization;

namespace Prompty.Core.JinjaSubset;

/// <summary>
/// Turns the <see cref="Tokenizer"/> stream into the parse AST (spec/jinja-grammar.md
/// §4). Includes a small expression sub-lexer and a recursive-descent expression
/// parser implementing the §3 grammar (no arithmetic). Ported from the Python
/// reference parser (runtime/python/prompty/prompty/jinja_subset/parser.py).
/// </summary>
internal static class Parser
{
    public static List<Node> ParseTemplate(string template)
    {
        var parser = new TemplateParser(Tokenizer.Tokenize(template));
        return parser.Parse();
    }

    // --- Expression lexer ---------------------------------------------------

    private enum ETokKind { String, Number, Op, Keyword, Name }

    private sealed class ETok
    {
        public ETokKind Kind { get; }
        public object Value { get; }

        public ETok(ETokKind kind, object value)
        {
            Kind = kind;
            Value = value;
        }
    }

    private static readonly HashSet<string> TwoCharOps = new(StringComparer.Ordinal) { "==", "!=", "<=", ">=" };
    private static readonly HashSet<char> OneCharOps = new("()[].,|<>");
    private static readonly HashSet<string> Keywords = new(StringComparer.Ordinal)
    {
        "and", "or", "not", "in", "true", "false", "null",
    };

    private static List<ETok> LexExpr(string src)
    {
        var toks = new List<ETok>();
        int i = 0;
        int n = src.Length;
        while (i < n)
        {
            char c = src[i];
            if (c is ' ' or '\t' or '\r' or '\n')
            {
                i++;
                continue;
            }

            if (c is '"' or '\'')
            {
                char quote = c;
                i++;
                var buf = new System.Text.StringBuilder();
                while (i < n && src[i] != quote)
                {
                    if (src[i] == '\\' && i + 1 < n)
                    {
                        buf.Append(src[i + 1]);
                        i += 2;
                        continue;
                    }
                    buf.Append(src[i]);
                    i++;
                }
                if (i >= n)
                    throw new TemplateSyntaxException($"Unterminated string in expression: {src}");
                i++; // closing quote
                toks.Add(new ETok(ETokKind.String, buf.ToString()));
                continue;
            }

            if (char.IsDigit(c) || (c == '-' && i + 1 < n && char.IsDigit(src[i + 1])))
            {
                int j = i + 1;
                while (j < n && (char.IsDigit(src[j]) || src[j] == '.'))
                    j++;
                string num = src.Substring(i, j - i);
                object value = num.Contains('.', StringComparison.Ordinal)
                    ? double.Parse(num, CultureInfo.InvariantCulture)
                    : long.Parse(num, CultureInfo.InvariantCulture);
                toks.Add(new ETok(ETokKind.Number, value));
                i = j;
                continue;
            }

            if (char.IsLetter(c) || c == '_')
            {
                int j = i + 1;
                while (j < n && (char.IsLetterOrDigit(src[j]) || src[j] == '_'))
                    j++;
                string word = src.Substring(i, j - i);
                toks.Add(new ETok(Keywords.Contains(word) ? ETokKind.Keyword : ETokKind.Name, word));
                i = j;
                continue;
            }

            if (i + 2 <= n)
            {
                string two = src.Substring(i, 2);
                if (TwoCharOps.Contains(two))
                {
                    toks.Add(new ETok(ETokKind.Op, two));
                    i += 2;
                    continue;
                }
            }

            if (OneCharOps.Contains(c))
            {
                toks.Add(new ETok(ETokKind.Op, c.ToString()));
                i++;
                continue;
            }

            throw new TemplateSyntaxException($"Unexpected character '{c}' in expression: {src}");
        }
        return toks;
    }

    // --- Expression parser (recursive descent) ------------------------------

    private sealed class ExprParser
    {
        private readonly List<ETok> _toks;
        private readonly string _src;
        private int _pos;

        public ExprParser(List<ETok> toks, string src)
        {
            _toks = toks;
            _src = src;
        }

        private ETok? Peek() => _pos < _toks.Count ? _toks[_pos] : null;

        private ETok Next()
        {
            var tok = _toks[_pos];
            _pos++;
            return tok;
        }

        private bool Is(ETokKind kind, object value)
        {
            var t = Peek();
            return t is not null && t.Kind == kind && Equals(t.Value, value);
        }

        public Expr Parse()
        {
            var expr = ParseOr();
            if (_pos != _toks.Count)
                throw new TemplateSyntaxException($"Trailing tokens in expression: {_src}");
            return expr;
        }

        private Expr ParseOr()
        {
            var left = ParseAnd();
            while (Is(ETokKind.Keyword, "or"))
            {
                Next();
                var right = ParseAnd();
                left = new BinaryExpr { Operator = "or", Left = left, Right = right };
            }
            return left;
        }

        private Expr ParseAnd()
        {
            var left = ParseNot();
            while (Is(ETokKind.Keyword, "and"))
            {
                Next();
                var right = ParseNot();
                left = new BinaryExpr { Operator = "and", Left = left, Right = right };
            }
            return left;
        }

        private Expr ParseNot()
        {
            if (Is(ETokKind.Keyword, "not"))
            {
                Next();
                return new UnaryExpr { Operator = "not", Operand = ParseNot() };
            }
            return ParseComparison();
        }

        private Expr ParseComparison()
        {
            var left = ParseFilter();
            var t = Peek();
            if (t is not null && t.Kind == ETokKind.Op && t.Value is string op &&
                op is "==" or "!=" or "<" or ">" or "<=" or ">=")
            {
                Next();
                var right = ParseFilter();
                return new BinaryExpr { Operator = op, Left = left, Right = right };
            }
            if (Is(ETokKind.Keyword, "in"))
            {
                Next();
                var right = ParseFilter();
                return new BinaryExpr { Operator = "in", Left = left, Right = right };
            }
            return left;
        }

        private Expr ParseFilter()
        {
            var expr = ParsePrimary();
            while (Is(ETokKind.Op, "|"))
            {
                Next();
                var nameTok = Peek();
                if (nameTok is null || nameTok.Kind != ETokKind.Name)
                    throw new TemplateSyntaxException($"Expected filter name in: {_src}");
                var name = (string)Next().Value;
                var args = new List<Expr>();
                if (Is(ETokKind.Op, "("))
                {
                    Next();
                    if (!Is(ETokKind.Op, ")"))
                    {
                        args.Add(ParseOr());
                        while (Is(ETokKind.Op, ","))
                        {
                            Next();
                            args.Add(ParseOr());
                        }
                    }
                    if (!Is(ETokKind.Op, ")"))
                        throw new TemplateSyntaxException($"Unclosed filter args in: {_src}");
                    Next();
                }
                expr = new FilterExpr { Name = name, Input = expr, Args = args };
            }
            return expr;
        }

        private Expr ParsePrimary()
        {
            var t = Peek();
            if (t is null)
                throw new TemplateSyntaxException($"Unexpected end of expression: {_src}");
            if (t.Kind == ETokKind.Op && Equals(t.Value, "("))
            {
                Next();
                var expr = ParseOr();
                if (!Is(ETokKind.Op, ")"))
                    throw new TemplateSyntaxException($"Unclosed parenthesis in: {_src}");
                Next();
                return expr;
            }
            if (t.Kind == ETokKind.String)
            {
                Next();
                return new LitExpr { Value = t.Value };
            }
            if (t.Kind == ETokKind.Number)
            {
                Next();
                return new LitExpr { Value = t.Value };
            }
            if (t.Kind == ETokKind.Keyword && t.Value is string kw && kw is "true" or "false" or "null")
            {
                Next();
                object? value = kw switch
                {
                    "true" => true,
                    "false" => false,
                    _ => null,
                };
                return new LitExpr { Value = value };
            }
            if (t.Kind == ETokKind.Name)
                return ParseAccessor();
            throw new TemplateSyntaxException($"Unexpected token '{t.Value}' in expression: {_src}");
        }

        private Expr ParseAccessor()
        {
            var root = (string)Next().Value;
            var path = new List<PathSeg>();
            while (true)
            {
                if (Is(ETokKind.Op, "."))
                {
                    Next();
                    var attrTok = Peek();
                    if (attrTok is null || (attrTok.Kind != ETokKind.Name && attrTok.Kind != ETokKind.Keyword))
                        throw new TemplateSyntaxException($"Expected attribute name in: {_src}");
                    path.Add(new AttrSeg { Name = (string)Next().Value });
                }
                else if (Is(ETokKind.Op, "["))
                {
                    Next();
                    var indexExpr = ParseOr();
                    if (!Is(ETokKind.Op, "]"))
                        throw new TemplateSyntaxException($"Unclosed index in: {_src}");
                    Next();
                    path.Add(new IndexSeg { Expr = indexExpr });
                }
                else
                {
                    break;
                }
            }
            return new VarExpr { Root = root, Path = path };
        }
    }

    private static Expr ParseExpression(string src) => new ExprParser(LexExpr(src), src).Parse();

    // --- Template / statement parser ----------------------------------------

    private static (string Head, string Remainder) StmtHead(string inner)
    {
        var parts = inner.Split((char[]?)null, 2, StringSplitOptions.RemoveEmptyEntries);
        string head = parts.Length > 0 ? parts[0] : string.Empty;
        string rest = parts.Length > 1 ? parts[1] : string.Empty;
        return (head, rest);
    }

    private sealed class TemplateParser
    {
        private readonly List<Token> _tokens;
        private int _pos;

        public TemplateParser(List<Token> tokens)
        {
            _tokens = tokens;
        }

        private Token? Peek() => _pos < _tokens.Count ? _tokens[_pos] : null;

        public List<Node> Parse() => ParseNodes(Array.Empty<string>());

        private List<Node> ParseNodes(string[] terminators)
        {
            var nodes = new List<Node>();
            while (_pos < _tokens.Count)
            {
                var tok = _tokens[_pos];
                if (tok.Type == TokenType.Stmt)
                {
                    var (head, _) = StmtHead(tok.Value);
                    if (terminators.Contains(head))
                        return nodes;
                    if (head == "if")
                    {
                        nodes.Add(ParseIf());
                        continue;
                    }
                    if (head == "for")
                    {
                        nodes.Add(ParseFor());
                        continue;
                    }
                    throw new TemplateSyntaxException($"Unexpected statement '{tok.Value}'");
                }
                if (tok.Type == TokenType.Text)
                {
                    _pos++;
                    nodes.Add(new TextNode { Value = tok.Value });
                    continue;
                }
                if (tok.Type == TokenType.Expr)
                {
                    _pos++;
                    nodes.Add(new InterpNode { Expr = ParseExpression(tok.Value) });
                    continue;
                }
                throw new TemplateSyntaxException($"Unexpected token type {tok.Type}");
            }
            if (terminators.Length > 0)
                throw new TemplateSyntaxException($"Unclosed block; expected one of {string.Join(", ", terminators)}");
            return nodes;
        }

        private IfNode ParseIf()
        {
            var branches = new List<Branch>();
            var (_, rest) = StmtHead(_tokens[_pos].Value);
            _pos++;
            branches.Add(new Branch { Test = ParseExpression(rest), Body = ParseNodes(new[] { "elif", "else", "endif" }) });
            List<Node>? elseBody = null;
            while (true)
            {
                var tok = Peek();
                if (tok is null)
                    throw new TemplateSyntaxException("Unclosed 'if' block");
                var (head, r) = StmtHead(tok.Value);
                if (head == "elif")
                {
                    _pos++;
                    branches.Add(new Branch { Test = ParseExpression(r), Body = ParseNodes(new[] { "elif", "else", "endif" }) });
                    continue;
                }
                if (head == "else")
                {
                    _pos++;
                    elseBody = ParseNodes(new[] { "endif" });
                    continue;
                }
                if (head == "endif")
                {
                    _pos++;
                    break;
                }
                throw new TemplateSyntaxException($"Unexpected '{tok.Value}' in if block");
            }
            return new IfNode { Branches = branches, ElseBody = elseBody };
        }

        private ForNode ParseFor()
        {
            var (_, rest) = StmtHead(_tokens[_pos].Value);
            _pos++;
            // rest looks like: "item in items"
            var parts = rest.Split((char[]?)null, 3, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 3 || parts[1] != "in")
                throw new TemplateSyntaxException($"Malformed for statement: 'for {rest}'");
            string loopVar = parts[0];
            var seqExpr = ParseExpression(parts[2]);
            var body = ParseNodes(new[] { "endfor" });
            var endfor = Peek();
            if (endfor is null || StmtHead(endfor.Value).Head != "endfor")
                throw new TemplateSyntaxException("Unclosed 'for' block");
            _pos++;
            return new ForNode { LoopVar = loopVar, Seq = seqExpr, Body = body };
        }
    }
}
