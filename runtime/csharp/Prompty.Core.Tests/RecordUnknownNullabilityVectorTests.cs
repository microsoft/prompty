// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using System.Text.Json.Nodes;
using Prompty.Core;

namespace Prompty.Core.Tests;

public class RecordUnknownNullabilityVectorTests
{
    private static readonly string VectorsPath = FindVectorsPath();

    [Fact]
    public void RecordUnknownNullabilityVectors_PreserveExplicitNullValues()
    {
        using var document = JsonDocument.Parse(File.ReadAllText(VectorsPath));
        var vectors = document.RootElement.GetProperty("vectors").EnumerateArray().ToArray();
        Assert.Equal(9, vectors.Length);
        var expectedCoverage = new HashSet<string>(StringComparer.Ordinal)
        {
            "Message:metadata",
            "Prompty:metadata",
            "ModelInfo:additionalProperties",
            "TurnModelRequest:inputs",
            "RunTurnRequest:inputs",
            "TurnModelResponse:checkpointState",
            "HostToolRequest:arguments",
            "TurnEvent:payload",
            "SessionEvent:payload",
        };
        var actualCoverage = vectors
            .Select(vector => $"{vector.GetProperty("model").GetString()}:{vector.GetProperty("fieldPath").GetString()}")
            .ToHashSet(StringComparer.Ordinal);
        Assert.True(
            expectedCoverage.SetEquals(actualCoverage),
            $"Record<unknown> vector coverage changed.\nExpected: {string.Join(", ", expectedCoverage)}\n"
            + $"Actual: {string.Join(", ", actualCoverage)}");

        foreach (var vector in vectors)
        {
            var name = vector.GetProperty("name").GetString()!;
            Assert.Equal("load-save-reload", vector.GetProperty("operation").GetString());

            var model = vector.GetProperty("model").GetString()!;
            var fieldPath = vector.GetProperty("fieldPath").GetString()!;
            var resaved = Roundtrip(model, vector.GetProperty("input").GetRawText());
            var actual = resaved.GetProperty(fieldPath);
            var expected = vector.GetProperty("expected");

            Assert.True(
                actual.TryGetProperty("direct", out var direct) && direct.ValueKind == JsonValueKind.Null,
                $"[{name}] direct null-valued key was lost or changed.");
            Assert.True(
                JsonNode.DeepEquals(JsonNode.Parse(expected.GetRawText()), JsonNode.Parse(actual.GetRawText())),
                $"[{name}] load/save/reload changed null-valued record entries.\nExpected: {expected}\nActual: {actual}");
        }
    }

    private static JsonElement Roundtrip(string model, string input)
    {
        var resaved = model switch
        {
            "Message" => Roundtrip<Message>(input, json => Message.FromJson(json), value => value.ToJson()),
            "Prompty" => Roundtrip<Prompty>(input, json => Prompty.FromJson(json), value => value.ToJson()),
            "ModelInfo" => Roundtrip<ModelInfo>(input, json => ModelInfo.FromJson(json), value => value.ToJson()),
            "TurnModelRequest" => Roundtrip<TurnModelRequest>(
                input,
                json => TurnModelRequest.FromJson(json),
                value => value.ToJson()),
            "RunTurnRequest" => Roundtrip<RunTurnRequest>(
                input,
                json => RunTurnRequest.FromJson(json),
                value => value.ToJson()),
            "TurnModelResponse" => Roundtrip<TurnModelResponse>(
                input,
                json => TurnModelResponse.FromJson(json),
                value => value.ToJson()),
            "HostToolRequest" => Roundtrip<HostToolRequest>(
                input,
                json => HostToolRequest.FromJson(json),
                value => value.ToJson()),
            "TurnEvent" => Roundtrip<TurnEvent>(input, json => TurnEvent.FromJson(json), value => value.ToJson()),
            "SessionEvent" => Roundtrip<SessionEvent>(
                input,
                json => SessionEvent.FromJson(json),
                value => value.ToJson()),
            _ => throw new InvalidOperationException($"Unsupported vector model '{model}'."),
        };
        using var document = JsonDocument.Parse(resaved);
        return document.RootElement.Clone();
    }

    private static string Roundtrip<T>(string input, Func<string, T> load, Func<T, string> save)
    {
        var loaded = load(input);
        var saved = save(loaded);
        var reloaded = load(saved);
        return save(reloaded);
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
                "record_unknown_nullability_vectors.json");
            if (File.Exists(candidate))
                return candidate;

            directory = Path.GetDirectoryName(directory) ?? directory;
        }

        throw new FileNotFoundException("Could not locate the shared Record<unknown> nullability vectors.");
    }
}
