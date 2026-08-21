// Copyright (c) Microsoft. All rights reserved.
using System.Globalization;
using System.Text.RegularExpressions;
using YamlDotNet.Core;
using YamlDotNet.RepresentationModel;

namespace Prompty.Core;

/// <summary>
/// Splits .prompty file content into YAML frontmatter and markdown body.
/// Frontmatter is delimited by --- or +++ markers.
/// </summary>
public static partial class FrontmatterParser
{
    // Matches --- or +++ delimited frontmatter followed by body content.
    // Group 1: frontmatter YAML, Group 2: markdown body.
    [GeneratedRegex(@"^\s*(?:---|\+\+\+)(.*?)(?:---|\+\+\+)\s*(.+)$", RegexOptions.Singleline)]
    private static partial Regex FrontmatterRegex();

    /// <summary>
    /// Parse .prompty file content into a dictionary.
    /// If frontmatter markers are present, splits frontmatter (YAML) from body (markdown).
    /// The body is stored under the "instructions" key.
    /// If no frontmatter markers, treats entire content as YAML.
    /// </summary>
    /// <param name="contents">Raw .prompty file content.</param>
    /// <returns>Dictionary with parsed frontmatter fields and optional "instructions" key.</returns>
    public static Dictionary<string, object?> Parse(string contents)
    {
        ArgumentNullException.ThrowIfNull(contents);

        // Check for frontmatter markers
        var trimmed = contents.TrimStart();
        if (trimmed.StartsWith("---") || trimmed.StartsWith("+++"))
        {
            var match = FrontmatterRegex().Match(contents);
            if (match.Success)
            {
                var frontmatter = match.Groups[1].Value;
                var body = match.Groups[2].Value;

                var data = DeserializeYaml(frontmatter);
                data["instructions"] = body;
                return data;
            }
        }

        // No frontmatter markers — treat entire content as YAML
        return DeserializeYaml(contents);
    }

    private static Dictionary<string, object?> DeserializeYaml(string yaml)
    {
        if (string.IsNullOrWhiteSpace(yaml))
            return new Dictionary<string, object?>();

        var stream = new YamlStream();
        using var reader = new StringReader(yaml);
        stream.Load(reader);

        if (stream.Documents.Count == 0)
            return new Dictionary<string, object?>();

        var root = stream.Documents[0].RootNode;
        return ConvertNode(root) as Dictionary<string, object?> ?? new Dictionary<string, object?>();
    }

    /// <summary>
    /// Recursively convert a YAML representation node into plain CLR objects, inferring
    /// scalar types (null/bool/int/long/double) for plain (unquoted) scalars while
    /// preserving quoted scalars as strings. This matches PyYAML's core-schema behavior
    /// used by the Python reference runtime, so numeric input defaults (e.g. <c>default: 5</c>)
    /// load as typed values rather than strings.
    /// </summary>
    private static object? ConvertNode(YamlNode node)
    {
        switch (node)
        {
            case YamlMappingNode map:
                var dict = new Dictionary<string, object?>();
                foreach (var entry in map.Children)
                {
                    var key = entry.Key is YamlScalarNode ks ? ks.Value ?? string.Empty : entry.Key.ToString();
                    dict[key] = ConvertNode(entry.Value);
                }
                return dict;
            case YamlSequenceNode seq:
                return seq.Children.Select(ConvertNode).ToList();
            case YamlScalarNode scalar:
                return ConvertScalar(scalar);
            default:
                return null;
        }
    }

    private static object? ConvertScalar(YamlScalarNode scalar)
    {
        var value = scalar.Value;
        if (value is null)
            return null;

        // Quoted / literal / folded scalars are always strings — quoting is explicit intent.
        if (scalar.Style is ScalarStyle.SingleQuoted or ScalarStyle.DoubleQuoted
            or ScalarStyle.Literal or ScalarStyle.Folded)
        {
            return value;
        }

        // Plain scalar — apply YAML core-schema type resolution (matches PyYAML safe_load).
        switch (value)
        {
            case "" or "~" or "null" or "Null" or "NULL":
                return null;
            case "true" or "True" or "TRUE":
                return true;
            case "false" or "False" or "FALSE":
                return false;
        }

        if (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var intValue))
            return intValue;
        if (long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var longValue))
            return longValue;
        if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var doubleValue))
            return doubleValue;

        return value;
    }
}
