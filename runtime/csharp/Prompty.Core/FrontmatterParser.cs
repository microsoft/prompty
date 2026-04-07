// Copyright (c) Microsoft. All rights reserved.
using System.Text.RegularExpressions;
using YamlDotNet.Serialization;

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
        var result = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml);
        return result ?? new Dictionary<string, object?>();
    }
}
