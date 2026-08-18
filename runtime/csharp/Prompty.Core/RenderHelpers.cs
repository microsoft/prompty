// Copyright (c) Microsoft. All rights reserved.

using System.Collections;
using System.Security.Cryptography;

namespace Prompty.Core;

/// <summary>
/// Shared helpers for template renderers: nonce generation and input preparation.
/// </summary>
public static class RenderHelpers
{
    /// <summary>
    /// Prefix for thread nonce markers per spec §5.2.
    /// Format: __PROMPTY_THREAD_{hex8}_{name}__
    /// </summary>
    public const string ThreadNoncePrefix = "__PROMPTY_THREAD_";

    /// <summary>
    /// Property names that must never be reachable through template member access.
    /// These are the classic prototype-pollution / prototype-chain escape hatches
    /// (mirrors the TypeScript renderer's UNSAFE_PROPERTIES set).
    /// </summary>
    private static readonly HashSet<string> UnsafeTemplateKeys = new(StringComparer.Ordinal)
    {
        "__proto__",
        "constructor",
        "prototype",
    };

    /// <summary>
    /// Recursively strips unsafe keys from rendering inputs before they reach the
    /// template engine. This is the C# equivalent of the TypeScript
    /// <c>sanitizeInputs</c> defense added for GHSA-w28w-gp39-m4p6 (server-side
    /// template injection in the renderer) and the sibling C# finding (issue #432).
    ///
    /// Even though Jinja2.NET blocks function calls, unsanitized inputs can still
    /// expose prototype-chain / constructor members via attribute access
    /// (<c>{{ obj.constructor }}</c>). Removing those keys keeps the template
    /// context to plain data only. A fresh copy is always returned; the caller's
    /// dictionary is never mutated.
    /// </summary>
    public static Dictionary<string, object?> SanitizeInputs(Dictionary<string, object?> inputs)
    {
        var result = new Dictionary<string, object?>(inputs.Count);
        foreach (var kvp in inputs)
        {
            if (UnsafeTemplateKeys.Contains(kvp.Key))
                continue;
            result[kvp.Key] = SanitizeValue(kvp.Value, new HashSet<object>(ReferenceEqualityComparer.Instance));
        }
        return result;
    }

    private static object? SanitizeValue(object? value, HashSet<object> seen)
    {
        switch (value)
        {
            case null:
            case string:
            case ValueType:
                return value;
        }

        // Guard against cyclic references in nested structures.
        if (!seen.Add(value!))
            return null;

        try
        {
            switch (value)
            {
                case IDictionary<string, object?> typed:
                    {
                        var map = new Dictionary<string, object?>(typed.Count);
                        foreach (var kvp in typed)
                        {
                            if (!UnsafeTemplateKeys.Contains(kvp.Key))
                                map[kvp.Key] = SanitizeValue(kvp.Value, seen);
                        }
                        return map;
                    }
                case IDictionary raw:
                    {
                        var map = new Dictionary<string, object?>(raw.Count);
                        foreach (DictionaryEntry entry in raw)
                        {
                            var key = entry.Key?.ToString();
                            if (key is not null && !UnsafeTemplateKeys.Contains(key))
                                map[key] = SanitizeValue(entry.Value, seen);
                        }
                        return map;
                    }
                case IEnumerable sequence:
                    {
                        var list = new List<object?>();
                        foreach (var item in sequence)
                            list.Add(SanitizeValue(item, seen));
                        return list;
                    }
                default:
                    // Non-collection reference types (e.g. Message) carry no
                    // template-reachable string-keyed members, so pass them through.
                    return value;
            }
        }
        finally
        {
            seen.Remove(value!);
        }
    }

    /// <summary>
    /// Prepares inputs for rendering by replacing rich-kind values with nonce markers.
    /// Rich kinds (thread, image, file, audio) can't be directly rendered as text —
    /// they're replaced with unique nonces that the parser later expands.
    /// </summary>
    /// <returns>
    /// A tuple of (modified inputs for rendering, nonce → property name mapping).
    /// </returns>
    public static (Dictionary<string, object?> Inputs, Dictionary<string, string> Nonces) PrepareRenderInputs(
        Agent agent,
        Dictionary<string, object?> inputs)
    {
        var renderInputs = new Dictionary<string, object?>(inputs);
        var nonces = new Dictionary<string, string>();

        if (agent.Inputs is null || agent.Inputs.Count == 0)
            return (renderInputs, nonces);

        foreach (var prop in agent.Inputs)
        {
            if (string.IsNullOrEmpty(prop.Name))
                continue;

            if (!RichKinds.All.Contains(prop.Kind ?? ""))
                continue;

            var hex = GenerateHex(4);
            var nonce = $"{ThreadNoncePrefix}{hex}_{prop.Name}__";
            nonces[nonce] = prop.Name;
            renderInputs[prop.Name] = nonce;
        }

        return (renderInputs, nonces);
    }

    /// <summary>
    /// Generates a random hex string of the specified byte length (output is 2× bytes chars).
    /// </summary>
    internal static string GenerateHex(int bytes)
    {
        var buffer = new byte[bytes];
        RandomNumberGenerator.Fill(buffer);
        return Convert.ToHexString(buffer).ToLowerInvariant();
    }
}
