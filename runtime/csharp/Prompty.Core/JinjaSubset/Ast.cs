// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core.JinjaSubset;

// Parse AST for the Prompty Jinja Subset (spec/jinja-grammar.md §4), mirrored in
// schema/model/conformance/ast-model.tsp. Ported from the Python reference
// parser (runtime/python/prompty/prompty/jinja_subset/parser.py), where nodes are
// plain dicts with a "kind" discriminator; here they are idiomatic C# classes.

/// <summary>Base type for expression AST nodes.</summary>
internal abstract class Expr { }

/// <summary>A literal string, number, boolean, or null value.</summary>
internal sealed class LitExpr : Expr
{
    public object? Value { get; init; }
}

/// <summary>Base type for a variable accessor path segment.</summary>
internal abstract class PathSeg { }

/// <summary>Dotted attribute access: <c>.name</c>.</summary>
internal sealed class AttrSeg : PathSeg
{
    public string Name { get; init; } = string.Empty;
}

/// <summary>Subscript access: <c>[expr]</c>.</summary>
internal sealed class IndexSeg : PathSeg
{
    public Expr Expr { get; init; } = default!;
}

/// <summary>A variable reference with an optional accessor path.</summary>
internal sealed class VarExpr : Expr
{
    public string Root { get; init; } = string.Empty;
    public List<PathSeg> Path { get; init; } = new();
}

/// <summary>A filter application: <c>input | name(args...)</c>.</summary>
internal sealed class FilterExpr : Expr
{
    public string Name { get; init; } = string.Empty;
    public Expr Input { get; init; } = default!;
    public List<Expr> Args { get; init; } = new();
}

/// <summary>A unary operation (only <c>not</c> in this subset).</summary>
internal sealed class UnaryExpr : Expr
{
    public string Operator { get; init; } = string.Empty;
    public Expr Operand { get; init; } = default!;
}

/// <summary>A binary operation (logical, comparison, membership).</summary>
internal sealed class BinaryExpr : Expr
{
    public string Operator { get; init; } = string.Empty;
    public Expr Left { get; init; } = default!;
    public Expr Right { get; init; } = default!;
}

/// <summary>Base type for template body nodes.</summary>
internal abstract class Node { }

/// <summary>Literal template text.</summary>
internal sealed class TextNode : Node
{
    public string Value { get; init; } = string.Empty;
}

/// <summary>An interpolation: <c>{{ expr }}</c>.</summary>
internal sealed class InterpNode : Node
{
    public Expr Expr { get; init; } = default!;
}

/// <summary>One <c>if</c>/<c>elif</c> branch: a test plus its body.</summary>
internal sealed class Branch
{
    public Expr Test { get; init; } = default!;
    public List<Node> Body { get; init; } = new();
}

/// <summary>An <c>if</c>/<c>elif</c>/<c>else</c> statement.</summary>
internal sealed class IfNode : Node
{
    public List<Branch> Branches { get; init; } = new();
    public List<Node>? ElseBody { get; set; }
}

/// <summary>A <c>for</c> loop over a sequence.</summary>
internal sealed class ForNode : Node
{
    public string LoopVar { get; init; } = string.Empty;
    public Expr Seq { get; init; } = default!;
    public List<Node> Body { get; init; } = new();
}
