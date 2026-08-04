// Copyright (c) Microsoft. All rights reserved.
using YamlDotNet.Serialization;

namespace Prompty.Core;

/// <summary>
/// Splits .prompty file content into YAML frontmatter and markdown body.
/// Frontmatter is delimited by --- or +++ markers.
/// </summary>
public static class FrontmatterParser
{
    /// <summary>
    /// Parse .prompty file content into a dictionary.
    /// If frontmatter markers are present, splits frontmatter (YAML) from body (markdown).
    /// The body is stored under the "instructions" key.
    /// If no frontmatter markers are present, treats the entire content as instructions.
    /// </summary>
    /// <param name="contents">Raw .prompty file content.</param>
    /// <returns>Dictionary with parsed frontmatter fields and optional "instructions" key.</returns>
    public static Dictionary<string, object?> Parse(string contents)
    {
        ArgumentNullException.ThrowIfNull(contents);

        var trimmed = contents.TrimStart();
        var openingLineEnd = trimmed.IndexOf('\n');
        var openingLine = (openingLineEnd >= 0 ? trimmed[..openingLineEnd] : trimmed).Trim();
        if (openingLine is not "---" and not "+++")
        {
            return new Dictionary<string, object?> { ["instructions"] = contents };
        }

        if (openingLineEnd < 0)
        {
            return new Dictionary<string, object?> { ["instructions"] = string.Empty };
        }

        var frontmatterStart = openingLineEnd + 1;
        var lineStart = frontmatterStart;
        while (lineStart <= trimmed.Length)
        {
            var lineEnd = trimmed.IndexOf('\n', lineStart);
            var line = (lineEnd >= 0 ? trimmed[lineStart..lineEnd] : trimmed[lineStart..]).Trim();
            if (line is "---" or "+++")
            {
                var data = DeserializeYaml(trimmed[frontmatterStart..lineStart]);
                data["instructions"] = lineEnd >= 0 ? trimmed[(lineEnd + 1)..] : string.Empty;
                return data;
            }

            if (lineEnd < 0)
            {
                break;
            }

            lineStart = lineEnd + 1;
        }

        throw new InvalidOperationException("Opening frontmatter delimiter does not have a closing delimiter.");
    }

    private static Dictionary<string, object?> DeserializeYaml(string yaml)
    {
        var result = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml);
        return result ?? new Dictionary<string, object?>();
    }
}
