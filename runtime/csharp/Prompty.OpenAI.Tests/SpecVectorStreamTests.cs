// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using Prompty.Core;
using Prompty.OpenAI;

namespace Prompty.OpenAI.Tests;

/// <summary>
/// Spec vector tests for the <c>Processor.processStream</c> stage — loads the canonical
/// processStream vectors from schema/tsp-output/.typra-generated/vectors.json and drives
/// them through the real provider stream classifier (<see cref="OpenAIProcessor.ClassifyStreamEvents"/>)
/// plus the provider-agnostic reconciler (<see cref="StreamReconciliation.Reconcile"/>).
///
/// The Core conformance harness cannot reference the OpenAI provider package, so the
/// processStream contract is driven green here at the provider layer (mirroring the
/// process / toRequest spec-vector runners).
/// </summary>
public class SpecVectorStreamTests
{
    private static readonly (string Name, JsonElement Input, JsonElement Expected)[] Vectors = LoadVectors();

    private static (string, JsonElement, JsonElement)[] LoadVectors()
    {
        var dir = AppContext.BaseDirectory;
        string? root = null;
        for (var i = 0; i < 10; i++)
        {
            if (Directory.Exists(Path.Combine(dir, "schema")))
            {
                root = dir;
                break;
            }
            dir = Path.GetDirectoryName(dir) ?? dir;
        }
        root ??= Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));

        var path = Path.Combine(root, "schema", "tsp-output", ".typra-generated", "vectors.json");
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        var result = new List<(string, JsonElement, JsonElement)>();
        foreach (var env in doc.RootElement.GetProperty("vectors").EnumerateArray())
        {
            if (env.GetProperty("operation").GetString() != "processStream") continue;
            var vec = env.GetProperty("vector");
            result.Add((
                vec.GetProperty("name").GetString()!,
                vec.GetProperty("input").Clone(),
                vec.GetProperty("expected").Clone()));
        }
        return [.. result];
    }

    public static IEnumerable<object[]> StreamVectors()
    {
        foreach (var (name, input, expected) in Vectors)
        {
            yield return [name, input, expected];
        }
    }

    [Theory]
    [MemberData(nameof(StreamVectors))]
    public void ProcessStream_Vectors(string name, JsonElement input, JsonElement expected)
    {
        var provider = input.GetProperty("provider").GetString();
        Assert.Equal("openai", provider);

        var chunks = OpenAIProcessor.ClassifyStreamEvents(input.GetProperty("events"));
        var reconciliation = StreamReconciliation.Reconcile(chunks);

        var observed = new Dictionary<string, object?>
        {
            ["chunks"] = chunks.Select(c => c.Save()).ToList(),
        };
        foreach (var kv in reconciliation.Save())
        {
            observed[kv.Key] = kv.Value;
        }

        var observedJson = Canonical(JsonSerializer.SerializeToElement(observed));
        var expectedJson = Canonical(expected);
        Assert.True(expectedJson == observedJson, $"[{name}] expected {expectedJson} but observed {observedJson}");
    }

    /// <summary>Deterministic canonical JSON (sorted keys) for order-insensitive equality.</summary>
    private static string Canonical(JsonElement element)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            WriteCanonical(element, writer);
        }
        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }

    private static void WriteCanonical(JsonElement element, Utf8JsonWriter writer)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var prop in element.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal))
                {
                    writer.WritePropertyName(prop.Name);
                    WriteCanonical(prop.Value, writer);
                }
                writer.WriteEndObject();
                break;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in element.EnumerateArray())
                {
                    WriteCanonical(item, writer);
                }
                writer.WriteEndArray();
                break;
            default:
                element.WriteTo(writer);
                break;
        }
    }
}
