// Copyright (c) Microsoft. All rights reserved.
using System.Collections;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;

namespace Prompty.Core;

/// <summary>
/// Endpoint trust — keeps ambient credentials on host-approved destinations (spec §2.5.1).
///
/// A <c>.prompty</c> file is untrusted input. When its connection carries no file-supplied
/// credential, executors fall back to ambient credentials (<c>DefaultAzureCredential</c>,
/// <c>*_API_KEY</c> env vars). This class decides whether the file-chosen destination may
/// receive them.
/// </summary>
public static partial class EndpointTrust
{
    /// <summary>Env var holding comma-separated, host-approved trusted origins.</summary>
    public const string TrustedEndpointsEnv = "PROMPTY_TRUSTED_ENDPOINTS";

    /// <summary>First-party provider origins that are always trusted.</summary>
    public static readonly IReadOnlyList<string> BuiltinTrustedEndpoints =
    [
        "https://api.openai.com",
        "https://api.anthropic.com",
        "https://*.openai.azure.com",
        "https://*.services.ai.azure.com",
        "https://*.cognitiveservices.azure.com",
        "https://login.microsoftonline.com",
    ];

    private static readonly string[] DestinationKeys = ["endpoint", "tokenUrl"];

    /// <summary>
    /// Return <c>true</c> if <paramref name="url"/>'s origin matches a built-in, host-supplied,
    /// or <c>PROMPTY_TRUSTED_ENDPOINTS</c> trusted origin.
    /// </summary>
    public static bool IsTrustedEndpoint(string url, IEnumerable<string>? trustedEndpoints = null)
    {
        var entries = TrustedEntries(trustedEndpoints);
        if (entries.Contains("*"))
            return true;

        var target = Origin(url);
        if (target is null)
            return false;
        var (scheme, host, port) = target.Value;

        foreach (var entry in entries)
        {
            var allowed = Origin(entry);
            if (allowed is null || allowed.Value.Scheme != scheme || allowed.Value.Port != port)
                continue;
            var pattern = allowed.Value.Host;
            if (pattern.StartsWith("*.", StringComparison.Ordinal))
            {
                if (host.EndsWith(pattern[1..], StringComparison.Ordinal))
                    return true;
            }
            else if (pattern == host)
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Throw an <c>untrusted_endpoint</c> <see cref="PromptyLoadException"/> if ambient
    /// credentials could reach a file-chosen, untrusted destination.
    /// </summary>
    /// <param name="connection">The RAW (unresolved) <c>model.connection</c> mapping.</param>
    /// <param name="trustedEndpoints">Host-supplied trusted origins.</param>
    public static void CheckConnectionTrust(object? connection, IEnumerable<string>? trustedEndpoints = null)
    {
        if (connection is not IDictionary conn || Get(conn, "kind") is "reference")
            return;
        if (FileSuppliedCredential(conn))
            return;

        foreach (var key in DestinationKeys)
        {
            var destination = FileControlledDestination(Get(conn, key));
            if (destination is not null && !IsTrustedEndpoint(destination, trustedEndpoints))
            {
                throw new PromptyLoadException(
                    "untrusted_endpoint",
                    $"Connection {key} '{destination}' is not trusted to receive ambient credentials. "
                    + $"Set the {key} via ${{env:VAR}}, add its origin to TrustedEndpoints or "
                    + $"{TrustedEndpointsEnv}, or use 'kind: reference'.");
            }
        }
    }

    private static List<string> TrustedEntries(IEnumerable<string>? trustedEndpoints)
    {
        var entries = new List<string?>(BuiltinTrustedEndpoints);
        if (trustedEndpoints is not null)
            entries.AddRange(trustedEndpoints);
        entries.AddRange((Environment.GetEnvironmentVariable(TrustedEndpointsEnv) ?? string.Empty).Split(','));
        return entries
            .Where(e => e is not null && e.Trim().Length > 0)
            .Select(e => e!.Trim())
            .ToList();
    }

    private static object? Get(IDictionary dict, string key) => dict.Contains(key) ? dict[key] : null;

    private static bool IsReference(string value) =>
        value.StartsWith("${", StringComparison.Ordinal) && value.EndsWith('}');

    private static bool FileSuppliedCredential(IDictionary connection)
    {
        // Only the credential field the declared kind actually consumes counts; any other kind is ambient.
        var key = Get(connection, "kind") switch
        {
            "key" => "apiKey",
            "oauth" => "clientSecret",
            _ => null,
        };
        if (key is null)
            return false;
        return Get(connection, key) is string value && value.Length > 0 && !IsReference(value);
    }

    /// <summary>Return the effective destination if the file chose it, else <c>null</c>.</summary>
    private static string? FileControlledDestination(object? value)
    {
        if (value is null)
            return null;
        if (value is not string str)
            return Convert.ToString(value, CultureInfo.InvariantCulture);
        if (IsReference(str))
        {
            var inner = str[2..^1];
            var colon = inner.IndexOf(':');
            var protocol = colon < 0 ? inner : inner[..colon];
            var rest = colon < 0 ? string.Empty : inner[(colon + 1)..];
            if (protocol.Equals("env", StringComparison.OrdinalIgnoreCase))
            {
                var varColon = rest.IndexOf(':');
                var varName = varColon < 0 ? rest : rest[..varColon];
                var defaultValue = varColon < 0 ? string.Empty : rest[(varColon + 1)..];
                if (Environment.GetEnvironmentVariable(varName) is not null)
                    return null;
                return defaultValue.Length > 0 ? defaultValue : null;
            }
        }

        return str;
    }

    // -----------------------------------------------------------------------
    // Origin parsing — mirrors Python's urllib.parse.urlsplit semantics so every
    // runtime classifies the same URL identically (System.Uri differs on IDN,
    // userinfo, and malformed ports).
    // -----------------------------------------------------------------------

    private readonly record struct OriginParts(string Scheme, string Host, int Port);

    [GeneratedRegex(@"^v[a-fA-F0-9]+\.[a-zA-Z0-9\._~\-!\$&'\(\)\*\+,;=:]+$")]
    private static partial Regex IpvFutureRegex();

    private static OriginParts? Origin(string url)
    {
        var s = new string(url.Trim().Where(c => c is not ('\t' or '\r' or '\n')).ToArray());

        var scheme = string.Empty;
        var rest = s;
        var colon = s.IndexOf(':');
        if (colon > 0 && char.IsAsciiLetter(s[0])
            && s[..colon].All(c => char.IsAsciiLetterOrDigit(c) || c is '+' or '-' or '.'))
        {
            scheme = s[..colon].ToLowerInvariant();
            rest = s[(colon + 1)..];
        }

        if (scheme is not ("http" or "https"))
            return null;

        var netloc = string.Empty;
        if (rest.StartsWith("//", StringComparison.Ordinal))
        {
            var after = rest[2..];
            var end = after.IndexOfAny(['/', '?', '#']);
            netloc = end < 0 ? after : after[..end];
        }

        if (netloc.Contains('[') != netloc.Contains(']'))
            return null;
        if (!CheckNetloc(netloc))
            return null;

        var at = netloc.LastIndexOf('@');
        var hostinfo = at < 0 ? netloc : netloc[(at + 1)..];
        string hostname;
        string port;
        var openBracket = hostinfo.IndexOf('[');
        if (openBracket >= 0)
        {
            var bracketed = hostinfo[(openBracket + 1)..];
            var close = bracketed.IndexOf(']');
            hostname = close < 0 ? bracketed : bracketed[..close];
            var afterClose = close < 0 ? string.Empty : bracketed[(close + 1)..];
            var portColon = afterClose.IndexOf(':');
            port = portColon < 0 ? string.Empty : afterClose[(portColon + 1)..];
            if (!IsValidBracketedHost(hostname))
                return null;
        }
        else
        {
            var portColon = hostinfo.IndexOf(':');
            hostname = portColon < 0 ? hostinfo : hostinfo[..portColon];
            port = portColon < 0 ? string.Empty : hostinfo[(portColon + 1)..];
        }

        hostname = hostname.ToLowerInvariant();
        if (hostname.Length == 0)
            return null;

        int portNumber;
        if (port.Length == 0)
        {
            portNumber = scheme == "http" ? 80 : 443;
        }
        else
        {
            if (!port.All(char.IsAsciiDigit))
                return null;
            var trimmed = port.TrimStart('0');
            if (trimmed.Length > 5 || !int.TryParse(trimmed.Length == 0 ? "0" : trimmed, out portNumber)
                || portNumber > 65535)
                return null;
        }

        return new OriginParts(scheme, hostname, portNumber);
    }

    private static bool CheckNetloc(string netloc)
    {
        if (netloc.Length == 0 || netloc.All(char.IsAscii))
            return true;
        var n = netloc.Replace("@", "").Replace(":", "").Replace("#", "").Replace("?", "");
        var normalized = n.Normalize(NormalizationForm.FormKC);
        if (n == normalized)
            return true;
        return normalized.IndexOfAny(['/', '?', '#', '@', ':']) < 0;
    }

    private static bool IsValidBracketedHost(string host)
    {
        if (host.StartsWith('v'))
            return IpvFutureRegex().IsMatch(host);
        return IPAddress.TryParse(host, out var ip) && ip.AddressFamily == AddressFamily.InterNetworkV6;
    }
}
