// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using System.Text.Json.Nodes;
using Prompty.Core;

namespace Prompty.Core.Tests;

public class PropertyScalarCoercionVectorTests
{
    private static readonly string VectorsPath = FindVectorsPath();

    [Fact]
    public void AllPrimitivePropertyScalarsCoerceAtomically()
    {
        using var document = JsonDocument.Parse(File.ReadAllText(VectorsPath));
        var vectors = document.RootElement.GetProperty("vectors").EnumerateArray().ToArray();
        Assert.Single(vectors);

        var vector = vectors[0];
        Assert.Equal("all_primitive_property_scalars_coerce_atomically", vector.GetProperty("name").GetString());
        Assert.Equal("load", vector.GetProperty("operation").GetString());

        var cases = vector.GetProperty("cases").EnumerateArray().ToArray();
        Assert.Equal(
            ["string", "integer", "float", "boolean"],
            cases.Select(candidate => candidate.GetProperty("name").GetString()).ToArray());

        foreach (var scalarCase in cases)
        {
            var name = scalarCase.GetProperty("name").GetString();
            var expected = scalarCase.GetProperty("expected");
            var loaded = Property.FromJson(scalarCase.GetProperty("input").GetRawText());

            Assert.Equal(expected.GetProperty("kind").GetString(), loaded.Kind);
            Assert.True(
                JsonNode.DeepEquals(
                    JsonNode.Parse(expected.GetProperty("example").GetRawText()),
                    JsonNode.Parse(JsonSerializer.Serialize(loaded.Example))),
                $"[{name}] changed or dropped the Property example.");
        }
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
                "property_scalar_coercion_vectors.json");
            if (File.Exists(candidate))
                return candidate;

            directory = Path.GetDirectoryName(directory) ?? directory;
        }

        throw new FileNotFoundException("Could not locate the shared Property scalar coercion vectors.");
    }
}
