// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

/// <summary>
/// Loads .prompty files into typed Prompty instances.
/// Flow: read file → parse frontmatter/body → resolve ${env:}/${file:} refs → Prompty.Load().
/// </summary>
public static class PromptyLoader
{
    /// <summary>
    /// Load a .prompty file and return a fully typed Prompty instance.
    /// </summary>
    /// <param name="path">Path to the .prompty file (absolute or relative to cwd).</param>
    /// <returns>A loaded Prompty instance with instructions from the markdown body.</returns>
    /// <exception cref="FileNotFoundException">If the file does not exist.</exception>
    /// <exception cref="InvalidOperationException">If frontmatter is invalid or env vars are missing.</exception>
    public static Prompty Load(string path)
    {
        var fullPath = Path.GetFullPath(path);
        if (!File.Exists(fullPath))
            throw new FileNotFoundException($"Prompty file not found: '{fullPath}'", fullPath);

        var contents = File.ReadAllText(fullPath);
        return Build(contents, fullPath);
    }

    /// <summary>
    /// Asynchronously load a .prompty file and return a fully typed Prompty instance.
    /// </summary>
    /// <param name="path">Path to the .prompty file (absolute or relative to cwd).</param>
    /// <param name="cancellationToken">Optional cancellation token.</param>
    /// <returns>A loaded Prompty instance with instructions from the markdown body.</returns>
    public static async Task<Prompty> LoadAsync(string path, CancellationToken cancellationToken = default)
    {
        var fullPath = Path.GetFullPath(path);
        if (!File.Exists(fullPath))
            throw new FileNotFoundException($"Prompty file not found: '{fullPath}'", fullPath);

        var contents = await File.ReadAllTextAsync(fullPath, cancellationToken);
        return Build(contents, fullPath);
    }

    /// <summary>
    /// Core loading logic shared by sync and async paths.
    /// </summary>
    private static Prompty Build(string contents, string fullPath)
    {
        // 1. Split frontmatter + body
        var data = FrontmatterParser.Parse(contents);

        // 2. Load via typed model with ${env:}/${file:} resolution
        var ctx = new LoadContext
        {
            PreProcess = ReferenceResolver.CreatePreProcess(fullPath),
        };

        var agent = Prompty.Load(data, ctx);

        // 3. Attach source path in metadata
        agent.Metadata ??= new Dictionary<string, object>();
        agent.Metadata["__source_path"] = fullPath;

        return agent;
    }
}
