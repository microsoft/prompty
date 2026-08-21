// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core.JinjaSubset;

/// <summary>Lexical token categories produced by <see cref="Tokenizer"/>.</summary>
internal enum TokenType
{
    Text,
    Expr,
    Stmt,
    Comment,
}

/// <summary>
/// A single lexical token. <see cref="Value"/> is the raw text for
/// <see cref="TokenType.Text"/> tokens, or the delimiter- and trim-marker-stripped
/// inner source for tag tokens.
/// </summary>
internal sealed class Token
{
    public TokenType Type { get; }
    public string Value { get; set; }
    public bool TrimLeft { get; }
    public bool TrimRight { get; }

    public Token(TokenType type, string value, bool trimLeft = false, bool trimRight = false)
    {
        Type = type;
        Value = value;
        TrimLeft = trimLeft;
        TrimRight = trimRight;
    }
}

/// <summary>
/// Scans a raw template string into a flat token stream of literal text and tag
/// regions (<c>{{ }}</c> expressions, <c>{% %}</c> statements, <c>{# #}</c>
/// comments), applying the <c>{%- … -%}</c> / <c>{{- … -}}</c> whitespace-trim
/// markers. Ported from the Python reference tokenizer
/// (runtime/python/prompty/prompty/jinja_subset/tokenizer.py).
/// </summary>
internal static class Tokenizer
{
    private static readonly Dictionary<string, (TokenType Kind, string Close)> Openers = new(StringComparer.Ordinal)
    {
        ["{{"] = (TokenType.Expr, "}}"),
        ["{%"] = (TokenType.Stmt, "%}"),
        ["{#"] = (TokenType.Comment, "#}"),
    };

    public static List<Token> Tokenize(string template)
    {
        var raw = new List<Token>();
        int i = 0;
        int n = template.Length;
        int textStart = 0;

        while (i < n)
        {
            string two = i + 2 <= n ? template.Substring(i, 2) : string.Empty;
            if (two.Length == 2 && Openers.TryGetValue(two, out var open))
            {
                // Flush any pending literal text.
                if (i > textStart)
                    raw.Add(new Token(TokenType.Text, template.Substring(textStart, i - textStart)));

                int closeIdx = template.IndexOf(open.Close, i + 2, StringComparison.Ordinal);
                if (closeIdx == -1)
                    throw new TemplateSyntaxException($"Unclosed '{two}' tag at offset {i}");

                string inner = template.Substring(i + 2, closeIdx - (i + 2));
                bool trimLeft = inner.StartsWith("-", StringComparison.Ordinal);
                bool trimRight = inner.EndsWith("-", StringComparison.Ordinal);
                if (trimLeft)
                    inner = inner.Substring(1);
                if (trimRight)
                    inner = inner.Substring(0, inner.Length - 1);

                if (open.Kind != TokenType.Comment)
                    raw.Add(new Token(open.Kind, inner.Trim(), trimLeft, trimRight));
                else
                    // Comment produces no node but still carries trim semantics.
                    raw.Add(new Token(TokenType.Comment, string.Empty, trimLeft, trimRight));

                i = closeIdx + open.Close.Length;
                textStart = i;
            }
            else
            {
                i++;
            }
        }

        if (textStart < n)
            raw.Add(new Token(TokenType.Text, template.Substring(textStart)));

        ApplyTrims(raw);
        return raw.Where(t => t.Type != TokenType.Comment).ToList();
    }

    private static void ApplyTrims(List<Token> tokens)
    {
        for (int idx = 0; idx < tokens.Count; idx++)
        {
            var tok = tokens[idx];
            if (tok.Type == TokenType.Text)
                continue;
            if (tok.TrimLeft && idx > 0 && tokens[idx - 1].Type == TokenType.Text)
                tokens[idx - 1].Value = tokens[idx - 1].Value.TrimEnd();
            if (tok.TrimRight && idx + 1 < tokens.Count && tokens[idx + 1].Type == TokenType.Text)
                tokens[idx + 1].Value = tokens[idx + 1].Value.TrimStart();
        }
    }
}
