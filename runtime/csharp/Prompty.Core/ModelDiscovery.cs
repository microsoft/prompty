// Copyright (c) Microsoft. All rights reserved.

using System.Reflection;
using System.Text.Json;

namespace Prompty.Core;

/// <summary>
/// Enriches generated model-discovery results from the shared capability dataset.
/// </summary>
public static class ModelDiscovery
{
    private const string ResourceName = "Prompty.Core.Data.model_capabilities.json";
    private static readonly Lazy<IReadOnlyDictionary<string, CapabilityEntry[]>> CapabilityTable =
        new(LoadCapabilityTable);

    /// <summary>
    /// Fill missing capability fields without replacing values supplied by a provider.
    /// </summary>
    public static void Enrich(string provider, ModelInfo info)
    {
        if (!CapabilityTable.Value.TryGetValue(provider, out var entries))
            return;

        var entry = entries.FirstOrDefault(candidate => PrefixMatches(info.Id, candidate.Prefix));
        if (entry is null)
            return;

        info.ContextWindow ??= entry.ContextWindow;
        info.InputModalities ??= entry.InputModalities?.ToArray();
        info.OutputModalities ??= entry.OutputModalities?.ToArray();
    }

    /// <summary>
    /// Convert a provider JSON object to a dictionary while preserving nested raw values.
    /// </summary>
    public static IDictionary<string, object?> PreserveRaw(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object)
            throw new ArgumentException("Provider model payload must be a JSON object.", nameof(value));

        return value.EnumerateObject()
            .ToDictionary(property => property.Name, property => (object?)property.Value.Clone());
    }

    private static bool PrefixMatches(string id, string prefix)
    {
        if (!id.StartsWith(prefix, StringComparison.Ordinal))
            return false;
        if (id.Length == prefix.Length)
            return true;

        return !char.IsAsciiLetterOrDigit(id[prefix.Length]);
    }

    private static IReadOnlyDictionary<string, CapabilityEntry[]> LoadCapabilityTable()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"Embedded capability dataset '{ResourceName}' was not found.");
        using var document = JsonDocument.Parse(stream);
        var providers = document.RootElement.GetProperty("providers");
        var result = new Dictionary<string, CapabilityEntry[]>();

        foreach (var provider in providers.EnumerateObject())
        {
            result[provider.Name] = provider.Value.EnumerateArray()
                .Select(CapabilityEntry.FromJson)
                .OrderByDescending(entry => entry.Prefix.Length)
                .ToArray();
        }

        return result;
    }

    private sealed record CapabilityEntry(
        string Prefix,
        int? ContextWindow,
        IList<string>? InputModalities,
        IList<string>? OutputModalities)
    {
        public static CapabilityEntry FromJson(JsonElement value) =>
            new(
                value.GetProperty("prefix").GetString()!,
                value.TryGetProperty("contextWindow", out var contextWindow) ? contextWindow.GetInt32() : null,
                ReadModalities(value, "inputModalities"),
                ReadModalities(value, "outputModalities"));

        private static IList<string>? ReadModalities(JsonElement value, string propertyName) =>
            value.TryGetProperty(propertyName, out var modalities)
                ? modalities.EnumerateArray().Select(item => item.GetString()!).ToArray()
                : null;
    }
}
