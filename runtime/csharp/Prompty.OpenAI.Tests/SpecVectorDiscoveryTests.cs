// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using System.Text.Json.Nodes;
using Prompty.Anthropic;
using Prompty.Core;
using Prompty.Foundry;

namespace Prompty.OpenAI.Tests;

/// <summary>
/// Executes the shared provider discovery and capability-enrichment contracts.
/// </summary>
public class SpecVectorDiscoveryTests
{
    private static readonly string SpecDir = FindSpecDir();

    [Theory]
    [MemberData(nameof(DiscoveryVectors))]
    public void Discovery_Mapping_MatchesSharedVector(
        string name,
        string provider,
        string shape,
        JsonElement input,
        JsonElement expected)
    {
        var actual = (provider, shape) switch
        {
            ("openai", "model") => OpenAIModels.MapModel(input),
            ("anthropic", "model") => AnthropicModels.MapModel(input),
            ("foundry", "deployment") => FoundryModels.MapDeployment(input),
            ("foundry", "catalog") => FoundryModels.MapCatalogModel(input),
            _ => throw new InvalidOperationException($"Unsupported discovery vector {provider}/{shape}."),
        };

        AssertJsonEqual(expected, JsonSerializer.SerializeToElement(actual.Save()), name);
    }

    [Theory]
    [MemberData(nameof(EnrichmentVectors))]
    public void Enrichment_MatchesSharedVector(
        string name,
        string provider,
        JsonElement input,
        JsonElement expected)
    {
        var model = ModelInfo.Load((Dictionary<string, object?>)ConvertValue(input)!);

        ModelDiscovery.Enrich(provider, model);

        AssertJsonEqual(expected, JsonSerializer.SerializeToElement(model.Save()), name);
    }

    [Fact]
    public void EmbeddedCapabilityDataset_MatchesCanonicalSpec()
    {
        var canonical = JsonNode.Parse(File.ReadAllText(Path.Combine(SpecDir, "data", "model_capabilities.json")));
        var embeddedPath = Path.Combine(
            FindRepositoryRoot(),
            "runtime",
            "csharp",
            "Prompty.Core",
            "Data",
            "model_capabilities.json");
        var embedded = JsonNode.Parse(File.ReadAllText(embeddedPath));

        Assert.True(JsonNode.DeepEquals(canonical, embedded), "The C# capability dataset copy has drifted from spec/data.");
    }

    [Fact]
    public void Enrichment_IsCaseSensitiveAndReturnsIndependentLists()
    {
        var upperCase = new ModelInfo { Id = "GPT-4O" };
        ModelDiscovery.Enrich("openai", upperCase);
        Assert.Null(upperCase.ContextWindow);

        var first = new ModelInfo { Id = "gpt-4o" };
        ModelDiscovery.Enrich("openai", first);
        first.InputModalities![0] = "mutated";

        var second = new ModelInfo { Id = "gpt-4o" };
        ModelDiscovery.Enrich("openai", second);
        Assert.Equal("text", second.InputModalities![0]);
    }

    public static IEnumerable<object[]> DiscoveryVectors() =>
        LoadVectors("discovery_vectors.json")
            .Select(vector => new object[]
            {
                vector.GetProperty("name").GetString()!,
                vector.GetProperty("provider").GetString()!,
                vector.GetProperty("shape").GetString()!,
                vector.GetProperty("input").Clone(),
                vector.GetProperty("expected").Clone(),
            });

    public static IEnumerable<object[]> EnrichmentVectors() =>
        LoadVectors("enrichment_vectors.json")
            .Select(vector => new object[]
            {
                vector.GetProperty("name").GetString()!,
                vector.GetProperty("provider").GetString()!,
                vector.GetProperty("input").Clone(),
                vector.GetProperty("expected").Clone(),
            });

    private static JsonElement[] LoadVectors(string fileName)
    {
        using var document = JsonDocument.Parse(
            File.ReadAllText(Path.Combine(SpecDir, "vectors", "discovery", fileName)));
        return document.RootElement.GetProperty("vectors").EnumerateArray().Select(item => item.Clone()).ToArray();
    }

    private static void AssertJsonEqual(JsonElement expected, JsonElement actual, string name)
    {
        var expectedNode = JsonNode.Parse(expected.GetRawText());
        var actualNode = JsonNode.Parse(actual.GetRawText());
        Assert.True(
            JsonNode.DeepEquals(expectedNode, actualNode),
            $"[{name}] expected {expected.GetRawText()}, actual {actual.GetRawText()}");
    }

    private static object? ConvertValue(JsonElement value) =>
        value.ValueKind switch
        {
            JsonValueKind.Object => value.EnumerateObject()
                .ToDictionary(property => property.Name, property => ConvertValue(property.Value)),
            JsonValueKind.Array => value.EnumerateArray().Select(ConvertValue).ToList(),
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number when value.TryGetInt32(out var intValue) => intValue,
            JsonValueKind.Number => value.GetDouble(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Null => null,
            _ => value.Clone(),
        };

    private static string FindSpecDir() => Path.Combine(FindRepositoryRoot(), "spec");

    private static string FindRepositoryRoot()
    {
        var directory = AppContext.BaseDirectory;
        for (var i = 0; i < 10; i++)
        {
            if (Directory.Exists(Path.Combine(directory, "spec")))
                return directory;
            directory = Path.GetDirectoryName(directory) ?? directory;
        }

        throw new DirectoryNotFoundException("Could not locate repository root containing spec/.");
    }
}
