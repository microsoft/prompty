// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using System.Text.Json.Nodes;

namespace Prompty.Core.Tests;

/// <summary>
/// Named-collection load/save/reload contracts backed by the shared model vectors.
/// Ported from the Rust reference suite so the contract is executed against the
/// C# emitted models rather than assumed to hold.
/// </summary>
public class NamedCollectionVectorTests
{
    private static readonly string VectorsPath = FindVectorsPath();

    public static TheoryData<string> RoundtripVectorNames() => VectorNames("load-save-reload");

    public static TheoryData<string> RejectionVectorNames() => VectorNames("load-error");

    [Theory]
    [MemberData(nameof(RoundtripVectorNames))]
    public void NamedCollectionVectors_RoundtripThroughLoadSaveReload(string vectorName)
    {
        var vector = FindVector(vectorName);
        var expected = vector.GetProperty("expected");
        var collectionPath = vector.GetProperty("collectionPath").GetString()!;
        var input = JsonElementToDict(vector.GetProperty("input"));

        var loaded = Prompty.Load(input);
        var saved = loaded.Save();
        AssertNamedCollection(vectorName, ExtractCollection(vectorName, saved, collectionPath), expected);

        var reloaded = Prompty.Load(saved);
        var resaved = reloaded.Save();
        AssertNamedCollection(vectorName, ExtractCollection(vectorName, resaved, collectionPath), expected);
    }

    [Theory]
    [MemberData(nameof(RejectionVectorNames))]
    public void NamedCollectionVectors_RejectInvalidEntries(string vectorName)
    {
        var vector = FindVector(vectorName);
        var expected = vector.GetProperty("expected");
        var input = JsonElementToDict(vector.GetProperty("input"));

        var thrown = Record.Exception(() => Prompty.Load(input));
        Assert.True(
            thrown is not null,
            $"[{vectorName}] expected rejection at {expected.GetProperty("path").GetString()} " +
            $"(category {expected.GetProperty("valueCategory").GetString()}), but load succeeded.");
    }

    private static JsonNode ExtractCollection(
        string vectorName,
        Dictionary<string, object?> saved,
        string collectionPath)
    {
        var savedNode = JsonNode.Parse(JsonSerializer.Serialize(saved))!.AsObject();
        Assert.True(
            savedNode.TryGetPropertyValue(collectionPath, out var collection) && collection is not null,
            $"[{vectorName}] missing collection \"{collectionPath}\" after save.");
        return collection!;
    }

    /// <summary>
    /// Normalizes either named-collection wire form into a comparable list of
    /// entries carrying an explicit name.
    /// </summary>
    private static List<JsonObject> SemanticEntries(string vectorName, JsonNode collection)
    {
        if (collection is JsonArray array)
        {
            var entries = new List<JsonObject>(array.Count);
            for (var index = 0; index < array.Count; index++)
            {
                var entry = array[index] as JsonObject;
                Assert.True(entry is not null, $"[{vectorName}] array-form entry {index} must be an object.");
                var clone = (JsonObject)entry!.DeepClone();
                if (!clone.ContainsKey("name"))
                    clone["name"] = "";
                entries.Add(clone);
            }

            return entries;
        }

        var collectionObject = collection as JsonObject;
        Assert.True(collectionObject is not null, $"[{vectorName}] named collection must be an array or object.");

        return collectionObject!
            .Select(pair => pair.Key)
            .OrderBy(name => name, StringComparer.Ordinal)
            .Select(name =>
            {
                var entry = collectionObject[name] as JsonObject;
                Assert.True(entry is not null, $"[{vectorName}] object-form entry \"{name}\" must be an object.");
                var clone = (JsonObject)entry!.DeepClone();
                clone["name"] = name;
                return clone;
            })
            .ToList();
    }

    /// <summary>
    /// Every field the vector declares must be present and equal. Fields the
    /// vector does not mention are ignored.
    /// </summary>
    private static void AssertSubset(JsonNode? actual, JsonNode? expected, string path)
    {
        if (expected is not JsonObject expectedObject)
        {
            Assert.True(
                JsonNode.DeepEquals(actual, expected),
                $"{path}: expected {expected?.ToJsonString() ?? "null"}, got {actual?.ToJsonString() ?? "null"}");
            return;
        }

        var actualObject = actual as JsonObject;
        Assert.True(actualObject is not null, $"{path}: expected an object, got {actual?.ToJsonString() ?? "null"}");

        foreach (var (key, expectedValue) in expectedObject)
        {
            Assert.True(actualObject!.ContainsKey(key), $"{path}: missing field \"{key}\"");
            AssertSubset(actualObject[key], expectedValue, $"{path}.{key}");
        }
    }

    private static void AssertNamedCollection(string vectorName, JsonNode collection, JsonElement expected)
    {
        var expectedFormat = expected.GetProperty("collectionFormat").GetString()!;
        var actualFormat = collection is JsonArray ? "array" : "object";
        Assert.True(
            actualFormat == expectedFormat,
            $"[{vectorName}] expected {expectedFormat} collection form, got {actualFormat}.");

        // wireEntries assert on the raw saved payload: each is {index, absentFields},
        // requiring that the entry at that position never materializes a synthetic field.
        if (expected.TryGetProperty("wireEntries", out var wireEntries))
        {
            var rawEntries = (JsonArray)collection;
            foreach (var assertion in wireEntries.EnumerateArray())
            {
                var index = assertion.GetProperty("index").GetInt32();
                Assert.True(
                    index >= 0 && index < rawEntries.Count,
                    $"[{vectorName}] wire entry index {index} out of range ({rawEntries.Count} entries).");

                var entry = rawEntries[index] as JsonObject;
                Assert.True(entry is not null, $"[{vectorName}] wire entry {index} must be an object.");

                if (!assertion.TryGetProperty("absentFields", out var absentFields))
                    continue;

                foreach (var field in absentFields.EnumerateArray())
                {
                    var name = field.GetString()!;
                    Assert.True(
                        !entry!.ContainsKey(name),
                        $"[{vectorName}] wire entry {index} unexpectedly materialized field \"{name}\" " +
                        $"as {entry[name]?.ToJsonString() ?? "null"}.");
                }
            }
        }

        var actualEntries = SemanticEntries(vectorName, collection);
        var expectedEntries = expected.GetProperty("entries").EnumerateArray().ToList();
        Assert.True(
            actualEntries.Count == expectedEntries.Count,
            $"[{vectorName}] named collection entry count changed: " +
            $"expected {expectedEntries.Count}, got {actualEntries.Count}.");

        if (expected.TryGetProperty("absentEntryFields", out var absentEntryFields))
        {
            foreach (var entry in actualEntries)
            {
                foreach (var field in absentEntryFields.EnumerateArray())
                {
                    var name = field.GetString()!;
                    Assert.True(
                        !entry.ContainsKey(name),
                        $"[{vectorName}] entry {entry["name"]?.ToJsonString()} unexpectedly populated " +
                        $"field \"{name}\" with {entry[name]?.ToJsonString() ?? "null"}.");
                }
            }
        }

        if (expected.TryGetProperty("preserveOrder", out var preserveOrder) && preserveOrder.GetBoolean())
        {
            for (var index = 0; index < expectedEntries.Count; index++)
            {
                AssertSubset(
                    actualEntries[index],
                    JsonNode.Parse(expectedEntries[index].GetRawText()),
                    $"{vectorName}.entries[{index}]");
            }

            return;
        }

        var actualByName = actualEntries.ToDictionary(entry => entry["name"]!.GetValue<string>());
        foreach (var expectedEntry in expectedEntries)
        {
            var name = expectedEntry.GetProperty("name").GetString()!;
            Assert.True(actualByName.ContainsKey(name), $"[{vectorName}] missing named entry \"{name}\".");
            AssertSubset(
                actualByName[name],
                JsonNode.Parse(expectedEntry.GetRawText()),
                $"{vectorName}.entries.{name}");
        }
    }

    /// <summary>
    /// Recursively materializes JSON into native dictionaries and lists. The
    /// emitted loaders traverse those; raw JsonElement values are not walked.
    /// </summary>
    private static Dictionary<string, object?> JsonElementToDict(JsonElement element)
    {
        var dictionary = new Dictionary<string, object?>();
        if (element.ValueKind != JsonValueKind.Object)
            return dictionary;

        foreach (var property in element.EnumerateObject())
            dictionary[property.Name] = JsonElementToObject(property.Value);

        return dictionary;
    }

    private static object? JsonElementToObject(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.String => element.GetString(),
        JsonValueKind.Number => element.TryGetInt64(out var l)
            ? (l == (int)l ? (object)(int)l : l)
            : element.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null => null,
        JsonValueKind.Array => element.EnumerateArray().Select(JsonElementToObject).ToList(),
        JsonValueKind.Object => JsonElementToDict(element),
        _ => element.GetRawText(),
    };

    private static JsonElement FindVector(string vectorName)    {
        using var document = JsonDocument.Parse(File.ReadAllText(VectorsPath));
        return document.RootElement
            .GetProperty("vectors")
            .EnumerateArray()
            .Single(candidate => candidate.GetProperty("name").GetString() == vectorName)
            .Clone();
    }

    private static TheoryData<string> VectorNames(string operation)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(VectorsPath));
        var data = new TheoryData<string>();
        foreach (var vector in document.RootElement.GetProperty("vectors").EnumerateArray())
        {
            if (vector.GetProperty("operation").GetString() == operation)
                data.Add(vector.GetProperty("name").GetString()!);
        }

        return data;
    }

    private static string FindVectorsPath()
    {
        var directory = AppContext.BaseDirectory;
        for (var i = 0; i < 10; i++)
        {
            var candidate = Path.Combine(
                directory,
                "spec",
                "vectors",
                "model",
                "named_collection_vectors.json");
            if (File.Exists(candidate))
                return candidate;

            directory = Path.GetDirectoryName(directory) ?? directory;
        }

        throw new FileNotFoundException("Could not locate the shared named collection vectors.");
    }
}
