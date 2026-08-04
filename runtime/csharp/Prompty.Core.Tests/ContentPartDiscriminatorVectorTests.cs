// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using System.Text.Json.Nodes;
using Prompty.Core;

namespace Prompty.Core.Tests;

public class ContentPartDiscriminatorVectorTests
{
    private static readonly string VectorsPath = FindVectorsPath();

    [Theory]
    [InlineData("known_text_content_part_loads")]
    [InlineData("unknown_content_part_kind_is_rejected")]
    [InlineData("content_part_case_collision_is_rejected")]
    public void ContentPartDiscriminatorVectors_EnforceClosedCaseSensitiveKinds(string vectorName)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(VectorsPath));
        var vector = document.RootElement
            .GetProperty("vectors")
            .EnumerateArray()
            .Single(candidate => candidate.GetProperty("name").GetString() == vectorName);
        var input = vector.GetProperty("input");
        var expected = vector.GetProperty("expected");
        var data = JsonSerializer.Deserialize<Dictionary<string, object?>>(input.GetRawText())!;

        switch (vector.GetProperty("operation").GetString())
        {
            case "load":
                var loaded = ContentPart.Load(data);
                Assert.IsType<TextPart>(loaded);
                AssertJsonEqual(vectorName, expected, loaded.Save());
                break;
            case "load-error":
                var exception = Assert.ThrowsAny<ArgumentException>(() => ContentPart.Load(data));
                Assert.Contains(expected.GetProperty("discriminator").GetString()!, exception.Message);
                Assert.Contains(expected.GetProperty("value").GetString()!, exception.Message);
                break;
            default:
                throw new InvalidOperationException($"[{vectorName}] unsupported vector operation.");
        }
    }

    private static void AssertJsonEqual(
        string vectorName,
        JsonElement expected,
        Dictionary<string, object?> actual)
    {
        var expectedNode = JsonNode.Parse(expected.GetRawText());
        var actualNode = JsonNode.Parse(JsonSerializer.Serialize(actual));
        Assert.True(
            JsonNode.DeepEquals(expectedNode, actualNode),
            $"[{vectorName}] load/save changed the ContentPart payload.\nExpected: {expectedNode}\nActual: {actualNode}");
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
                "content_part_discriminator_vectors.json");
            if (File.Exists(candidate))
                return candidate;

            directory = Path.GetDirectoryName(directory) ?? directory;
        }

        throw new FileNotFoundException("Could not locate the shared ContentPart discriminator vectors.");
    }
}
