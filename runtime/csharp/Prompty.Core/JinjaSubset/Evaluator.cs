// Copyright (c) Microsoft. All rights reserved.

using System.Collections;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Prompty.Core.JinjaSubset;

/// <summary>Sentinel for missing lookups. Falsy; stringifies to empty.</summary>
internal sealed class Undefined
{
    public static readonly Undefined Instance = new();
    private Undefined() { }
    public override string ToString() => string.Empty;
}

/// <summary>A provenance-tagged output segment (spec/jinja-grammar.md §7).</summary>
internal sealed class Segment
{
    public string Kind { get; init; } = string.Empty; // "literal" | "interp"
    public string Text { get; init; } = string.Empty;
    public string? Source { get; init; }
    public bool Strict { get; init; }
}

/// <summary>
/// Walks the parse AST with an input scope and produces the rendered segment tree
/// (spec/jinja-grammar.md §7). Implements the B2 leaf semantics of §5: lowercase
/// booleans, empty-string for null/undefined, insertion-order dict iteration, the
/// six core filters plus <c>replace</c>, and the <c>loop</c> object. A <c>strict</c>
/// input property whose interpolated value forges a role boundary raises loudly
/// (<see cref="StrictViolationException"/>). Ported from the Python reference
/// evaluator (runtime/python/prompty/prompty/jinja_subset/evaluator.py).
/// </summary>
internal static class Evaluator
{
    // Role-boundary pattern used for strict prompt-injection deterrence (§8.4).
    private static readonly Regex RoleBoundary = new(
        @"^\s*(system|user|assistant|developer)\s*:",
        RegexOptions.IgnoreCase | RegexOptions.Multiline | RegexOptions.Compiled);

    private sealed class Frame
    {
        public Dictionary<string, object?> Scope { get; }
        public HashSet<string> StrictProps { get; }

        public Frame(Dictionary<string, object?> scope, HashSet<string> strictProps)
        {
            Scope = scope;
            StrictProps = strictProps;
        }
    }

    public static List<Segment> RenderSegments(
        string template,
        IReadOnlyDictionary<string, object?>? inputs = null,
        IEnumerable<string>? strictProps = null)
    {
        var scope = inputs is null ? new Dictionary<string, object?>() : new Dictionary<string, object?>(inputs);
        var frame = new Frame(scope, strictProps is null ? new HashSet<string>() : new HashSet<string>(strictProps));
        var outp = new List<Segment>();
        RenderNodes(Parser.ParseTemplate(template), frame, outp);
        return outp;
    }

    public static string Render(
        string template,
        IReadOnlyDictionary<string, object?>? inputs = null,
        IEnumerable<string>? strictProps = null)
    {
        var sb = new StringBuilder();
        foreach (var seg in RenderSegments(template, inputs, strictProps))
            sb.Append(seg.Text);
        return sb.ToString();
    }

    // --- value semantics (§5) ----------------------------------------------

    private static bool IsInteger(object? value, out long result)
    {
        switch (value)
        {
            case sbyte or byte or short or ushort or int or uint or long:
                result = Convert.ToInt64(value, CultureInfo.InvariantCulture);
                return true;
            default:
                result = 0;
                return false;
        }
    }

    private static bool IsNumeric(object? value) =>
        IsInteger(value, out _) || value is float or double or decimal;

    private static double ToDouble(object? value) =>
        Convert.ToDouble(value, CultureInfo.InvariantCulture);

    private static bool Truthy(object? value)
    {
        if (value is null || value is Undefined)
            return false;
        if (value is bool b)
            return b;
        if (value is string s)
            return s.Length > 0;
        if (value is List<object?> list)
            return list.Count > 0;
        if (value is IDictionary<string, object?> dict)
            return dict.Count > 0;
        if (IsInteger(value, out var iv))
            return iv != 0;
        if (value is float or double or decimal)
            return ToDouble(value) != 0;
        return true;
    }

    private static string Stringify(object? value)
    {
        if (value is null || value is Undefined)
            return string.Empty;
        if (value is bool b)
            return b ? "true" : "false";
        if (value is float or double or decimal)
        {
            double d = ToDouble(value);
            if (!double.IsInfinity(d) && !double.IsNaN(d) && d == Math.Floor(d) && Math.Abs(d) < 9.2e18)
                return ((long)d).ToString(CultureInfo.InvariantCulture);
            return d.ToString("G15", CultureInfo.InvariantCulture);
        }
        if (IsInteger(value, out var iv))
            return iv.ToString(CultureInfo.InvariantCulture);
        if (value is string s)
            return s;
        if (value is IDictionary<string, object?> dict)
            return DictToString(dict);
        if (value is List<object?> list)
        {
            var sb = new StringBuilder();
            foreach (var item in list)
                sb.Append(Stringify(item));
            return sb.ToString();
        }
        if (value is IEnumerable seq && value is not string)
        {
            var sb = new StringBuilder();
            foreach (var item in seq)
                sb.Append(Stringify(item));
            return sb.ToString();
        }
        return value.ToString() ?? string.Empty;
    }

    private static string DictToString(IDictionary<string, object?> dict)
    {
        // Rarely hit; matches Python's str(dict) fallback shape loosely.
        var sb = new StringBuilder("{");
        bool first = true;
        foreach (var kvp in dict)
        {
            if (!first)
                sb.Append(", ");
            first = false;
            sb.Append('\'').Append(kvp.Key).Append("': ").Append(Stringify(kvp.Value));
        }
        sb.Append('}');
        return sb.ToString();
    }

    // --- expression evaluation ---------------------------------------------

    private static object? Lookup(string root, IReadOnlyDictionary<string, object?> scope) =>
        scope.TryGetValue(root, out var value) ? value : Undefined.Instance;

    private static object? Access(object? value, PathSeg seg, IReadOnlyDictionary<string, object?> scope)
    {
        if (value is null || value is Undefined)
            return Undefined.Instance;
        if (seg is AttrSeg attr)
        {
            if (value is IDictionary<string, object?> map)
                return map.TryGetValue(attr.Name, out var mv) ? mv : Undefined.Instance;
            return Undefined.Instance;
        }
        var idxSeg = (IndexSeg)seg;
        var index = EvalExpr(idxSeg.Expr, scope);
        try
        {
            if (value is IDictionary<string, object?> m2)
            {
                var key = index as string;
                if (key is not null && m2.TryGetValue(key, out var v2))
                    return v2;
                return Undefined.Instance;
            }
            if (value is List<object?> list)
            {
                int i = ToIndex(index);
                if (i < 0)
                    i += list.Count;
                return i >= 0 && i < list.Count ? list[i] : Undefined.Instance;
            }
            if (value is string s)
            {
                int i = ToIndex(index);
                if (i < 0)
                    i += s.Length;
                return i >= 0 && i < s.Length ? s[i].ToString() : Undefined.Instance;
            }
        }
        catch
        {
            return Undefined.Instance;
        }
        return Undefined.Instance;
    }

    private static int ToIndex(object? index)
    {
        if (IsInteger(index, out var iv))
            return checked((int)iv);
        if (index is float or double or decimal)
            return (int)ToDouble(index);
        if (index is string s)
            return int.Parse(s, CultureInfo.InvariantCulture);
        throw new InvalidOperationException("Non-integer index");
    }

    private static object? EvalExpr(Expr expr, IReadOnlyDictionary<string, object?> scope)
    {
        switch (expr)
        {
            case LitExpr lit:
                return lit.Value;
            case VarExpr var:
                object? value = Lookup(var.Root, scope);
                foreach (var seg in var.Path)
                    value = Access(value, seg, scope);
                return value;
            case FilterExpr filter:
                return ApplyFilter(filter, scope);
            case UnaryExpr unary:
                return !Truthy(EvalExpr(unary.Operand, scope));
            case BinaryExpr binary:
                return EvalBinary(binary, scope);
            default:
                throw new InvalidOperationException($"Unknown expression: {expr.GetType().Name}");
        }
    }

    private static object? EvalBinary(BinaryExpr expr, IReadOnlyDictionary<string, object?> scope)
    {
        string op = expr.Operator;
        if (op == "and")
        {
            var left = EvalExpr(expr.Left, scope);
            return Truthy(left) ? EvalExpr(expr.Right, scope) : left;
        }
        if (op == "or")
        {
            var left = EvalExpr(expr.Left, scope);
            return Truthy(left) ? left : EvalExpr(expr.Right, scope);
        }

        var l = EvalExpr(expr.Left, scope);
        var r = EvalExpr(expr.Right, scope);

        if (op == "in")
            return EvalIn(l, r);

        object? lc = l is Undefined ? null : l;
        object? rc = r is Undefined ? null : r;

        if (op == "==")
            return ValueEquals(lc, rc);
        if (op == "!=")
            return !ValueEquals(lc, rc);

        if (IsNumeric(lc) && IsNumeric(rc))
        {
            double x = ToDouble(lc);
            double y = ToDouble(rc);
            return op switch
            {
                "<" => x < y,
                ">" => x > y,
                "<=" => x <= y,
                ">=" => x >= y,
                _ => throw new InvalidOperationException($"Unknown binary operator: {op}"),
            };
        }
        if (lc is string ls && rc is string rs)
        {
            int cmp = string.CompareOrdinal(ls, rs);
            return op switch
            {
                "<" => cmp < 0,
                ">" => cmp > 0,
                "<=" => cmp <= 0,
                ">=" => cmp >= 0,
                _ => throw new InvalidOperationException($"Unknown binary operator: {op}"),
            };
        }
        // Mismatched/None operands: Python raises TypeError which is swallowed to False.
        return false;
    }

    private static bool EvalIn(object? left, object? right)
    {
        switch (right)
        {
            case IDictionary<string, object?> dict:
                return left is string ls && dict.ContainsKey(ls);
            case List<object?> list:
                return list.Any(e => ValueEquals(e is Undefined ? null : e, left is Undefined ? null : left));
            case string s:
                return left is string sub && s.Contains(sub, StringComparison.Ordinal);
            default:
                return false;
        }
    }

    private static bool ValueEquals(object? a, object? b)
    {
        if (a is null && b is null)
            return true;
        if (a is null || b is null)
            return false;
        if (IsNumeric(a) && IsNumeric(b))
            return ToDouble(a) == ToDouble(b);
        return a.Equals(b);
    }

    private static object? ApplyFilter(FilterExpr expr, IReadOnlyDictionary<string, object?> scope)
    {
        string name = expr.Name;
        var value = EvalExpr(expr.Input, scope);
        var args = expr.Args.Select(a => EvalExpr(a, scope)).ToList();
        switch (name)
        {
            case "upper":
                return Stringify(value).ToUpperInvariant();
            case "lower":
                return Stringify(value).ToLowerInvariant();
            case "trim":
                return Stringify(value).Trim();
            case "join":
            {
                string sep = args.Count > 0 ? Stringify(args[0]) : string.Empty;
                var seq = value is List<object?> l ? l : new List<object?>();
                return string.Join(sep, seq.Select(Stringify));
            }
            case "length":
                if (value is null || value is Undefined)
                    return 0L;
                if (value is string s)
                    return (long)s.Length;
                if (value is List<object?> list)
                    return (long)list.Count;
                if (value is IDictionary<string, object?> dict)
                    return (long)dict.Count;
                return 0L;
            case "default":
            {
                object? fallback = args.Count > 0 ? args[0] : string.Empty;
                return value is null || value is Undefined ? fallback : value;
            }
            case "replace":
                if (args.Count < 2)
                    throw new InvalidOperationException("replace filter requires (old, new) arguments");
                string subject = Stringify(value);
                string oldValue = Stringify(args[0]);
                if (oldValue.Length == 0)
                    return subject;
                return subject.Replace(oldValue, Stringify(args[1]), StringComparison.Ordinal);
            default:
                throw new InvalidOperationException($"Unknown filter: {name}");
        }
    }

    // --- rendering to segments ----------------------------------------------

    private static IReadOnlyList<object?> IterSeq(object? value)
    {
        if (value is null || value is Undefined)
            return Array.Empty<object?>();
        if (value is IDictionary<string, object?> dict)
            return dict.Keys.Cast<object?>().ToList(); // insertion order (Bucket A #7)
        if (value is List<object?> list)
            return new List<object?>(list);
        if (value is string s)
            return s.Select(c => (object?)c.ToString()).ToList();
        return Array.Empty<object?>();
    }

    private static string? InterpSource(Expr expr) =>
        expr is VarExpr var ? var.Root : null;

    private static void RenderNodes(IReadOnlyList<Node> nodes, Frame frame, List<Segment> outp)
    {
        foreach (var node in nodes)
        {
            switch (node)
            {
                case TextNode text:
                    if (text.Value.Length > 0)
                        outp.Add(new Segment { Kind = "literal", Text = text.Value });
                    break;
                case InterpNode interp:
                {
                    var value = EvalExpr(interp.Expr, frame.Scope);
                    string text = Stringify(value);
                    string? source = InterpSource(interp.Expr);
                    bool isStrict = source is not null && frame.StrictProps.Contains(source);
                    if (isStrict && RoleBoundary.IsMatch(text))
                        throw new StrictViolationException(
                            $"strict input '{source}' produced a forged role boundary: {text}");
                    outp.Add(new Segment { Kind = "interp", Text = text, Source = source, Strict = isStrict });
                    break;
                }
                case IfNode iff:
                    RenderIf(iff, frame, outp);
                    break;
                case ForNode forn:
                    RenderFor(forn, frame, outp);
                    break;
                default:
                    throw new InvalidOperationException($"Unknown node: {node.GetType().Name}");
            }
        }
    }

    private static void RenderIf(IfNode node, Frame frame, List<Segment> outp)
    {
        foreach (var branch in node.Branches)
        {
            if (Truthy(EvalExpr(branch.Test, frame.Scope)))
            {
                RenderNodes(branch.Body, frame, outp);
                return;
            }
        }
        if (node.ElseBody is not null)
            RenderNodes(node.ElseBody, frame, outp);
    }

    private static void RenderFor(ForNode node, Frame frame, List<Segment> outp)
    {
        var items = IterSeq(EvalExpr(node.Seq, frame.Scope)).ToList();
        int total = items.Count;
        for (int idx = 0; idx < total; idx++)
        {
            var childScope = new Dictionary<string, object?>(frame.Scope)
            {
                [node.LoopVar] = items[idx],
                ["loop"] = new Dictionary<string, object?>
                {
                    ["index"] = (long)(idx + 1),
                    ["index0"] = (long)idx,
                    ["first"] = idx == 0,
                    ["last"] = idx == total - 1,
                    ["length"] = (long)total,
                },
            };
            RenderNodes(node.Body, new Frame(childScope, frame.StrictProps), outp);
        }
    }
}
