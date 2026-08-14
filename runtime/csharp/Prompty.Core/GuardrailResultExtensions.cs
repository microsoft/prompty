// Copyright (c) Microsoft. All rights reserved.

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

public partial class GuardrailResult
{
    /// <summary>
    /// Convenience constructor matching the old record signature.
    /// </summary>
    public GuardrailResult(bool allowed, string? reason = null, object? rewrite = null)
    {
        Allowed = allowed;
        Reason = reason;
        Rewrite = rewrite;
    }
}
