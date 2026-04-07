// Copyright (c) Microsoft. All rights reserved.

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
    /// Prepares inputs for rendering by replacing rich-kind values with nonce markers.
    /// Rich kinds (thread, image, file, audio) can't be directly rendered as text —
    /// they're replaced with unique nonces that the parser later expands.
    /// </summary>
    /// <returns>
    /// A tuple of (modified inputs for rendering, nonce → property name mapping).
    /// </returns>
    public static (Dictionary<string, object?> Inputs, Dictionary<string, string> Nonces) PrepareRenderInputs(
        Prompty agent,
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
