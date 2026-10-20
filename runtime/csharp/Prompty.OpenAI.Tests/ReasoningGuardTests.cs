// Copyright (c) Microsoft. All rights reserved.

#pragma warning disable OPENAI001

using System.ClientModel.Primitives;
using System.Text.Json;
using Prompty.Core;
using Prompty.OpenAI;

namespace Prompty.OpenAI.Tests;

public class ReasoningGuardTests
{
    [Fact]
    public void SharedExecutionGuardVectors()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !Directory.Exists(Path.Combine(root.FullName, "schema", "model")))
            root = root.Parent;
        Assert.NotNull(root);
        using var vectors = JsonDocument.Parse(File.ReadAllText(Path.Combine(root.FullName,
            "schema", "model", "conformance", "openai-reasoning-guard.json")));
        foreach (var vector in vectors.RootElement.EnumerateArray())
        {
            var model = vector.GetProperty("model").GetString()!;
            var options = ModelOptions.Load((Dictionary<string, object?>)ToValue(
                vector.GetProperty("options"))!, new LoadContext());
            var agent = new Core.Agent { Model = new Model { Id = model, Options = options } };
            var before = JsonSerializer.Serialize(options.Save());
            var chat = ModelReaderWriter.Write(WireFormat.BuildOptions(agent), ModelReaderWriterOptions.Json);
            var responses = ModelReaderWriter.Write(
                WireFormat.BuildResponsesOptions(model, agent, []), ModelReaderWriterOptions.Json);
            foreach (var wire in new[] { chat, responses })
            {
                using var doc = JsonDocument.Parse(wire.ToString());
                var args = doc.RootElement;
                foreach (var key in vector.GetProperty("absent").EnumerateArray())
                    Assert.False(args.TryGetProperty(key.GetString()!, out _),
                        $"{vector.GetProperty("name")}: unexpected {key}: {args}");
                foreach (var expected in vector.GetProperty("present").EnumerateObject())
                {
                    Assert.True(args.TryGetProperty(expected.Name, out var actual),
                        $"{vector.GetProperty("name")}: missing {expected.Name}: {args}");
                    Assert.True(JsonElement.DeepEquals(expected.Value, actual),
                        $"{vector.GetProperty("name")}: {expected.Name}: {actual}");
                }
            }
            Assert.Equal(before, JsonSerializer.Serialize(options.Save()));
        }
    }

    private static object? ToValue(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Object => value.EnumerateObject().ToDictionary(p => p.Name, p => ToValue(p.Value)),
        JsonValueKind.Array => value.EnumerateArray().Select(ToValue).ToList(),
        JsonValueKind.String => value.GetString(),
        JsonValueKind.Number => value.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        _ => null,
    };
}
