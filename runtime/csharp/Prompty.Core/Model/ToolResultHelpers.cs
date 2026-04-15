// Copyright (c) Microsoft. All rights reserved.

// --- Runtime helpers (manually maintained) ---
// This file extends the generated ToolResult class with convenience members
// used by the Prompty pipeline and tool dispatch system.

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

public partial class ToolResult
{
    /// <summary>
    /// Create a ToolResult from a plain text string (wraps in a single TextPart).
    /// </summary>
    public static ToolResult FromText(string text) =>
        new() { Parts = [new TextPart { Value = text }] };

    /// <summary>
    /// Concatenated text from all TextParts in this result.
    /// </summary>
    public string TextContent => string.Join("", Parts.OfType<TextPart>().Select(p => p.Value));

    /// <summary>
    /// Implicit conversion from string for backward compatibility.
    /// Existing code returning strings from tool handlers will continue to work.
    /// </summary>
    public static implicit operator ToolResult(string text) => FromText(text);
}
