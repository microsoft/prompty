// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using System.Text.Json.Nodes;
using Prompty.Core;

namespace Prompty.Core.Tests;

public class ConnectionRoundtripVectorTests
{
    private static readonly string VectorsPath = FindVectorsPath();

    [Theory]
    [InlineData("known_reference_connection_roundtrip_unchanged")]
    [InlineData("unknown_connection_kind_preserves_payload")]
    [InlineData("unknown_connection_case_collision_preserves_payload")]
    public void ConnectionRoundtripVectors_PreserveExactDiscriminatorAndPayload(string vectorName)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(VectorsPath));
        var vector = document.RootElement
            .GetProperty("vectors")
            .EnumerateArray()
            .Single(candidate => candidate.GetProperty("name").GetString() == vectorName);

        var input = vector.GetProperty("input");
        var expected = vector.GetProperty("expected");
        var expectedKind = expected.GetProperty("kind").GetString()!;
        var data = JsonSerializer.Deserialize<Dictionary<string, object?>>(input.GetRawText())!;

        var loaded = Connection.Load(data);
        if (expectedKind == "reference")
            Assert.IsType<ReferenceConnection>(loaded);
        else
            Assert.IsNotType<ReferenceConnection>(loaded);

        var saved = loaded.Save();
        Assert.Equal(expectedKind, saved["kind"]);
        AssertJsonEqual(vectorName, "save", expected, saved);

        var reloaded = Connection.Load(saved);
        var resaved = reloaded.Save();
        Assert.Equal(expectedKind, resaved["kind"]);
        AssertJsonEqual(vectorName, "reload", expected, resaved);
    }

    private static void AssertJsonEqual(
        string vectorName,
        string operation,
        JsonElement expected,
        Dictionary<string, object?> actual)
    {
        var expectedNode = JsonNode.Parse(expected.GetRawText());
        var actualNode = JsonNode.Parse(JsonSerializer.Serialize(actual));
        Assert.True(
            JsonNode.DeepEquals(expectedNode, actualNode),
            $"[{vectorName}] {operation} changed the Connection payload.\nExpected: {expectedNode}\nActual: {actualNode}");
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
                "connection_roundtrip_vectors.json");
            if (File.Exists(candidate))
                return candidate;

            directory = Path.GetDirectoryName(directory) ?? directory;
        }

        throw new FileNotFoundException("Could not locate the shared Connection roundtrip vectors.");
    }
}
