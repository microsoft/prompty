// Copyright (c) Microsoft. All rights reserved.

using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Prompty.Core;

/// <summary>
/// Parses rendered text with role markers (system:, user:, assistant:, etc.)
/// into a list of Messages. Handles thread nonce expansion.
/// Registered under key "prompty".
/// </summary>
public partial class PromptyChatParser : IParser, IPreRenderable
{
    /// <summary>
    /// Regex matching role marker lines: "role:" or "role[attrs]:"
    /// Captures role name and optional attributes.
    /// </summary>
    [GeneratedRegex(@"^(system|user|assistant|developer|tool)(\[.*?\])?:\s*$", RegexOptions.Multiline)]
    private static partial Regex RoleMarkerRegex();

    /// <summary>
    /// Regex for thread nonce pattern: __PROMPTY_THREAD_{hex8}_{name}__
    /// </summary>
    [GeneratedRegex(@"__PROMPTY_THREAD_[a-f0-9]{8}_(\w+)__")]
    private static partial Regex ThreadNonceRegex();

    /// <summary>
    /// Regex for parsing attributes from role markers: key="value" or key=value
    /// </summary>
    [GeneratedRegex(@"(\w+)\s*=\s*""?([^"",\]]+)""?")]
    private static partial Regex AttrsRegex();

    /// <summary>
    /// The nonce injected by PreRender for strict mode validation.
    /// Uses AsyncLocal to be thread-safe across concurrent pipeline calls.
    /// </summary>
    private readonly AsyncLocal<string?> _renderNonce = new();

    // -----------------------------------------------------------------------
    // IPreRenderable — strict mode protection
    // -----------------------------------------------------------------------

    /// <summary>
    /// Sanitizes the template before rendering to protect against injection.
    /// Rewrites role markers to include a nonce that the parser validates.
    /// </summary>
    public (string template, Dictionary<string, object?> context) PreRender(string template)
    {
        var nonce = GenerateNonce();
        _renderNonce.Value = nonce;

        var sanitized = RoleMarkerRegex().Replace(template, match =>
        {
            var role = match.Groups[1].Value;
            var existingAttrs = match.Groups[2].Value; // e.g. "[key=val]" or ""
            if (string.IsNullOrEmpty(existingAttrs))
                return $"{role}[nonce=\"{nonce}\"]:\n";
            else
            {
                // Insert nonce into existing attrs
                var inner = existingAttrs.TrimStart('[').TrimEnd(']');
                return $"{role}[{inner}, nonce=\"{nonce}\"]:\n";
            }
        });

        return (sanitized, new Dictionary<string, object?> { ["nonce"] = nonce });
    }

    // -----------------------------------------------------------------------
    // IParser
    // -----------------------------------------------------------------------

    public Task<List<Message>> ParseAsync(Prompty agent, string rendered, Dictionary<string, object?>? context)
    {
        var messages = Parse(rendered);
        return Task.FromResult(messages);
    }

    /// <summary>
    /// Synchronous parse implementation.
    /// </summary>
    internal List<Message> Parse(string rendered)
    {
        var messages = new List<Message>();
        var lines = rendered.Split('\n');
        string? currentRole = null;
        var currentContent = new List<string>();
        Dictionary<string, string>? currentAttrs = null;

        foreach (var line in lines)
        {
            var match = RoleMarkerRegex().Match(line);
            if (match.Success)
            {
                // Flush previous message
                if (currentRole is not null)
                {
                    messages.Add(CreateMessage(currentRole, currentContent, currentAttrs));
                }

                currentRole = match.Groups[1].Value;
                currentAttrs = ParseAttributes(match.Groups[2].Value);
                currentContent = [];
            }
            else
            {
                currentContent.Add(line);
            }
        }

        // Flush last message
        if (currentRole is not null)
        {
            messages.Add(CreateMessage(currentRole, currentContent, currentAttrs));
        }
        else if (currentContent.Count > 0)
        {
            // No role markers at all — treat as system message
            var text = string.Join("\n", currentContent).Trim();
            if (!string.IsNullOrEmpty(text))
            {
                messages.Add(new Message
                {
                    Role = Roles.System,
                    Parts = [new TextPart { Value = text }]
                });
            }
        }

        return messages;
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private Message CreateMessage(string role, List<string> contentLines, Dictionary<string, string>? attrs)
    {
        // Validate nonce if strict mode was used
        if (_renderNonce.Value is not null && attrs is not null)
        {
            if (!attrs.TryGetValue("nonce", out var foundNonce) || foundNonce != _renderNonce.Value)
            {
                throw new InvalidOperationException(
                    $"Role marker injection detected: nonce mismatch for '{role}:' marker.");
            }
            attrs.Remove("nonce"); // Don't pass nonce through to metadata
        }

        var text = string.Join("\n", contentLines);
        // Trim leading/trailing blank lines but preserve internal whitespace
        text = text.Trim('\r', '\n');

        var message = new Message
        {
            Role = role,
            Parts = [new TextPart { Value = text }]
        };

        if (attrs is not null && attrs.Count > 0)
        {
            message.Metadata ??= new Dictionary<string, object>();
            foreach (var kvp in attrs)
                message.Metadata[kvp.Key] = kvp.Value;
        }

        return message;
    }

    private static Dictionary<string, string>? ParseAttributes(string attrGroup)
    {
        if (string.IsNullOrEmpty(attrGroup))
            return null;

        var inner = attrGroup.TrimStart('[').TrimEnd(']');
        if (string.IsNullOrWhiteSpace(inner))
            return null;

        var attrs = new Dictionary<string, string>();
        foreach (Match m in AttrsRegex().Matches(inner))
        {
            attrs[m.Groups[1].Value] = m.Groups[2].Value;
        }

        return attrs.Count > 0 ? attrs : null;
    }

    private static string GenerateNonce()
    {
        var buffer = new byte[8];
        RandomNumberGenerator.Fill(buffer);
        return Convert.ToHexString(buffer).ToLowerInvariant();
    }
}
