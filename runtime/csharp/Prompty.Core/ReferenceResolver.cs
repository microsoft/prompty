// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;

namespace Prompty.Core;

/// <summary>
/// Resolves ${env:VAR}, ${env:VAR:default}, and ${file:path} references in frontmatter dictionaries.
/// Used as a LoadContext.PreProcess callback to expand references during model loading.
/// </summary>
public static class ReferenceResolver
{
    private const string RefPrefix = "${";
    private const string RefSuffix = "}";

    /// <summary>
    /// Creates a PreProcess callback for LoadContext that resolves ${env:} and ${file:} references.
    /// References are resolved relative to the .prompty file's parent directory.
    /// </summary>
    /// <param name="promptyFilePath">Absolute path to the .prompty file (for resolving relative ${file:} refs).</param>
    /// <param name="allowedFileRoots">Additional directories that ${file:} references may read from.</param>
    /// <returns>A callback suitable for LoadContext.PreProcess.</returns>
    public static Func<Dictionary<string, object?>, Dictionary<string, object?>> CreatePreProcess(
        string promptyFilePath,
        IEnumerable<string>? allowedFileRoots = null)
    {
        var parentDir = Path.GetDirectoryName(GetCanonicalPath(promptyFilePath))
            ?? throw new ArgumentException($"Cannot determine parent directory of '{promptyFilePath}'");
        var allowedRoots = new[] { parentDir }
            .Concat(allowedFileRoots ?? [])
            .Select(GetCanonicalPath)
            .ToArray();

        return data => ResolveReferences(data, parentDir, allowedRoots);
    }

    /// <summary>
    /// Walks a dictionary and resolves any string values matching ${protocol:value} patterns.
    /// Only processes top-level string values in the given dictionary (recursive walking is
    /// handled by LoadContext calling PreProcess on each nested dict).
    /// </summary>
    internal static Dictionary<string, object?> ResolveReferences(
        Dictionary<string, object?> data,
        string parentDir,
        IReadOnlyCollection<string> allowedRoots)
    {
        foreach (var key in data.Keys.ToList())
        {
            var value = data[key];
            if (value is not string str)
                continue;
            if (!str.StartsWith(RefPrefix) || !str.EndsWith(RefSuffix))
                continue;

            var inner = str[RefPrefix.Length..^RefSuffix.Length];
            var colonIndex = inner.IndexOf(':');
            if (colonIndex < 0)
                continue;

            var protocol = inner[..colonIndex].ToLowerInvariant();
            var remainder = inner[(colonIndex + 1)..];

            switch (protocol)
            {
                case "env":
                    data[key] = ResolveEnvVar(remainder, key);
                    break;
                case "file":
                    data[key] = ResolveFileRef(remainder, parentDir, allowedRoots, key);
                    break;
                    // Unknown protocol: leave unchanged per spec §4
            }
        }

        return data;
    }

    /// <summary>
    /// Resolves ${env:VAR} or ${env:VAR:default}.
    /// </summary>
    private static object ResolveEnvVar(string remainder, string key)
    {
        // Split on first colon only — remainder after first colon is the default value
        var colonIndex = remainder.IndexOf(':');
        string varName;
        string? defaultValue;

        if (colonIndex >= 0)
        {
            varName = remainder[..colonIndex];
            defaultValue = remainder[(colonIndex + 1)..];
        }
        else
        {
            varName = remainder;
            defaultValue = null;
        }

        var envValue = Environment.GetEnvironmentVariable(varName);
        if (envValue is not null)
            return envValue;

        if (defaultValue is not null)
            return defaultValue;

        throw new InvalidOperationException(
            $"Environment variable '{varName}' is not set and no default provided (key: '{key}').");
    }

    /// <summary>
    /// Resolves ${file:relative/path}. Loads content based on file extension:
    /// .json → parsed as JSON object, .yaml/.yml → parsed as YAML object, else → raw text.
    /// </summary>
    private static object ResolveFileRef(
        string relativePath,
        string parentDir,
        IReadOnlyCollection<string> allowedRoots,
        string key)
    {
        var fullPath = Path.IsPathRooted(relativePath)
            ? Path.GetFullPath(relativePath)
            : Path.GetFullPath(Path.Combine(parentDir, relativePath));
        if (!File.Exists(fullPath))
            throw new FileNotFoundException(
                $"Referenced file '{relativePath}' not found (resolved to '{fullPath}', key: '{key}').");

        fullPath = GetCanonicalPath(fullPath);
        if (!allowedRoots.Any(root => IsWithinRoot(fullPath, root)))
        {
            throw new InvalidOperationException(
                $"File reference '{relativePath}' resolves outside allowed roots (resolved to '{fullPath}', key: '{key}').");
        }

        var content = File.ReadAllText(fullPath);
        var ext = Path.GetExtension(fullPath).ToLowerInvariant();

        return ext switch
        {
            ".json" => LoadJsonAsDict(content, fullPath),
            ".yaml" or ".yml" => LoadYamlAsDict(content),
            _ => content
        };
    }

    private static object LoadJsonAsDict(string content, string path)
    {
        try
        {
            var dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(content, JsonUtils.Options);
            return dict ?? throw new InvalidOperationException($"JSON file '{path}' deserialized to null.");
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException($"Failed to parse JSON file '{path}': {ex.Message}", ex);
        }
    }

    private static object LoadYamlAsDict(string content)
    {
        var result = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(content);
        return result ?? new Dictionary<string, object?>();
    }

    private static bool IsWithinRoot(string path, string root)
    {
        var relative = Path.GetRelativePath(root, path);
        return relative == "."
            || (!relative.StartsWith("..", StringComparison.Ordinal)
                && !Path.IsPathRooted(relative));
    }

    private static string GetCanonicalPath(string path)
    {
        var fullPath = Path.GetFullPath(path);
        var root = Path.GetPathRoot(fullPath);
        if (string.IsNullOrEmpty(root))
        {
            return fullPath;
        }

        var canonicalPath = root;
        var components = fullPath[root.Length..].Split(
            [Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar],
            StringSplitOptions.RemoveEmptyEntries);

        foreach (var component in components)
        {
            canonicalPath = Path.Combine(canonicalPath, component);
            var target = ResolveLinkTarget(canonicalPath);
            if (target is not null)
            {
                canonicalPath = Path.GetFullPath(target.FullName);
            }
        }

        return canonicalPath;
    }

    private static FileSystemInfo? ResolveLinkTarget(string path)
    {
        if (Directory.Exists(path))
        {
            return new DirectoryInfo(path).ResolveLinkTarget(returnFinalTarget: true);
        }

        if (File.Exists(path))
        {
            return new FileInfo(path).ResolveLinkTarget(returnFinalTarget: true);
        }

        return null;
    }
}
