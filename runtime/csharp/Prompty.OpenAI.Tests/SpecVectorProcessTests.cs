// Copyright (c) Microsoft. All rights reserved.

#pragma warning disable OPENAI001 // Responses API is in preview

using System.ClientModel.Primitives;
using System.Text.Json;
using OpenAI.Chat;
using OpenAI.Embeddings;
using OpenAI.Images;
using OpenAI.Responses;
using Prompty.Core;
using Prompty.OpenAI;
using Prompty.Anthropic;

namespace Prompty.OpenAI.Tests;

/// <summary>
/// Spec vector tests for the process stage — loads canonical vectors from
/// spec/vectors/process/process_vectors.json and passes them through real
/// production processors (OpenAIProcessor, AnthropicProcessor).
/// </summary>
public class SpecVectorProcessTests
{
    private static readonly string SpecDir = FindSpecDir();
    private static readonly string VectorsDir = Path.Combine(SpecDir, "vectors");
    private static readonly JsonElement[] Vectors = LoadVectors();

    private static string FindSpecDir()
    {
        var dir = AppContext.BaseDirectory;
        for (var i = 0; i < 10; i++)
        {
            var candidate = Path.Combine(dir, "spec");
            if (Directory.Exists(candidate)) return candidate;
            dir = Path.GetDirectoryName(dir) ?? dir;
        }
        var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
        return Path.Combine(root, "spec");
    }

    private static JsonElement[] LoadVectors()
    {
        var path = Path.Combine(VectorsDir, "process", "process_vectors.json");
        return JsonSerializer.Deserialize<JsonElement[]>(File.ReadAllText(path)) ?? [];
    }

    // -----------------------------------------------------------------------
    // OpenAI chat vectors
    // -----------------------------------------------------------------------

    [Theory]
    [MemberData(nameof(OpenAIChatVectors))]
    public async Task OpenAI_Chat_ProcessVectors(string name, JsonElement response, JsonElement expected, bool hasOutputs)
    {
        var agent = BuildAgent(hasOutputs);
        var chat = ModelReaderWriter.Read<ChatCompletion>(BinaryData.FromString(response.GetRawText()));
        Assert.NotNull(chat);

        var processor = new OpenAIProcessor();
        var result = await processor.ProcessAsync(agent, chat);

        AssertResultMatches(result, expected, name);
    }

    public static IEnumerable<object[]> OpenAIChatVectors()
    {
        foreach (var vec in Vectors)
        {
            var input = vec.GetProperty("input");
            var provider = input.GetProperty("provider").GetString();
            var apiType = input.GetProperty("apiType").GetString();
            if (provider != "openai" && provider != "azure" && provider != "foundry") continue;
            if (apiType != "chat") continue;

            var name = vec.GetProperty("name").GetString()!;
            var response = input.GetProperty("response");
            var expectedResult = vec.GetProperty("expected").GetProperty("result");
            var hasOutputs = input.TryGetProperty("has_outputs", out var ho) && ho.GetBoolean();

            yield return [name, response, expectedResult, hasOutputs];
        }
    }

    // -----------------------------------------------------------------------
    // OpenAI embedding vectors
    // -----------------------------------------------------------------------

    [Theory]
    [MemberData(nameof(OpenAIEmbeddingVectors))]
    public async Task OpenAI_Embedding_ProcessVectors(string name, JsonElement response, JsonElement expected)
    {
        var agent = BuildAgent(false);
        var embeddings = ModelReaderWriter.Read<OpenAIEmbeddingCollection>(
            BinaryData.FromString(response.GetRawText()));
        Assert.NotNull(embeddings);

        var processor = new OpenAIProcessor();
        var result = await processor.ProcessAsync(agent, embeddings);

        AssertEmbeddingsMatch(result, expected, name);
    }

    public static IEnumerable<object[]> OpenAIEmbeddingVectors()
    {
        foreach (var vec in Vectors)
        {
            var input = vec.GetProperty("input");
            var provider = input.GetProperty("provider").GetString();
            var apiType = input.GetProperty("apiType").GetString();
            if (provider != "openai" && provider != "azure" && provider != "foundry") continue;
            if (apiType != "embedding") continue;

            yield return [
                vec.GetProperty("name").GetString()!,
                input.GetProperty("response"),
                vec.GetProperty("expected").GetProperty("result"),
            ];
        }
    }

    // -----------------------------------------------------------------------
    // OpenAI image vectors
    // -----------------------------------------------------------------------

    [Theory]
    [MemberData(nameof(OpenAIImageVectors))]
    public async Task OpenAI_Image_ProcessVectors(string name, JsonElement response, JsonElement expected)
    {
        var agent = BuildAgent(false);

        // Image responses are GeneratedImageCollection; executor returns the first item
        var collection = ModelReaderWriter.Read<GeneratedImageCollection>(
            BinaryData.FromString(response.GetRawText()));
        Assert.NotNull(collection);
        Assert.True(collection.Count > 0, $"[{name}] Expected at least one image");

        var processor = new OpenAIProcessor();
        var result = await processor.ProcessAsync(agent, collection[0]);

        var expectedStr = expected.GetString()!;
        Assert.Equal(expectedStr, result?.ToString());
    }

    public static IEnumerable<object[]> OpenAIImageVectors()
    {
        foreach (var vec in Vectors)
        {
            var input = vec.GetProperty("input");
            var provider = input.GetProperty("provider").GetString();
            var apiType = input.GetProperty("apiType").GetString();
            if (provider != "openai" && provider != "azure" && provider != "foundry") continue;
            if (apiType != "image") continue;

            var name = vec.GetProperty("name").GetString()!;

            // Skip image_b64 — the test vector uses "base64data" which isn't valid base64,
            // and the OpenAI SDK rejects it during ModelReaderWriter deserialization
            if (name == "image_b64") continue;

            yield return [
                name,
                input.GetProperty("response"),
                vec.GetProperty("expected").GetProperty("result"),
            ];
        }
    }

    // -----------------------------------------------------------------------
    // OpenAI responses vectors
    // -----------------------------------------------------------------------

    [Theory]
    [MemberData(nameof(OpenAIResponsesVectors))]
    public async Task OpenAI_Responses_ProcessVectors(string name, JsonElement response, JsonElement expected, bool hasOutputs)
    {
        var agent = BuildAgent(hasOutputs);
        var responseResult = ModelReaderWriter.Read<ResponseResult>(
            BinaryData.FromString(response.GetRawText()));
        Assert.NotNull(responseResult);

        var processor = new OpenAIProcessor();
        var result = await processor.ProcessAsync(agent, responseResult);

        AssertResultMatches(result, expected, name);
    }

    public static IEnumerable<object[]> OpenAIResponsesVectors()
    {
        foreach (var vec in Vectors)
        {
            var input = vec.GetProperty("input");
            var provider = input.GetProperty("provider").GetString();
            var apiType = input.GetProperty("apiType").GetString();
            if (provider != "openai" && provider != "azure" && provider != "foundry") continue;
            if (apiType != "responses") continue;

            var name = vec.GetProperty("name").GetString()!;
            var response = input.GetProperty("response");
            var expectedResult = vec.GetProperty("expected").GetProperty("result");
            var hasOutputs = input.TryGetProperty("has_outputs", out var ho) && ho.GetBoolean();

            yield return [name, response, expectedResult, hasOutputs];
        }
    }

    // -----------------------------------------------------------------------
    // Anthropic vectors
    // -----------------------------------------------------------------------

    [Theory]
    [MemberData(nameof(AnthropicVectors))]
    public async Task Anthropic_ProcessVectors(string name, JsonElement response, JsonElement expected, bool hasOutputs)
    {
        var agent = BuildAgent(hasOutputs);
        var processor = new AnthropicProcessor();

        // Anthropic processor takes JsonElement directly
        var result = await processor.ProcessAsync(agent, response);

        AssertResultMatches(result, expected, name);
    }

    public static IEnumerable<object[]> AnthropicVectors()
    {
        foreach (var vec in Vectors)
        {
            var input = vec.GetProperty("input");
            var provider = input.GetProperty("provider").GetString();
            if (provider != "anthropic") continue;

            var name = vec.GetProperty("name").GetString()!;
            var response = input.GetProperty("response");
            var expectedResult = vec.GetProperty("expected").GetProperty("result");
            var hasOutputs = input.TryGetProperty("has_outputs", out var ho) && ho.GetBoolean();

            yield return [name, response, expectedResult, hasOutputs];
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private static Core.Prompty BuildAgent(bool hasOutputs)
    {
        var agent = new Core.Prompty { Name = "process_test" };
        if (hasOutputs)
        {
            agent.Outputs = [new Property { Name = "dummy", Kind = "string" }];
        }
        return agent;
    }

    /// <summary>
    /// Compares a processor result against expected JSON.
    /// Handles: string, object (JsonElement), ToolCallResult, null/empty.
    /// </summary>
    private static void AssertResultMatches(object result, JsonElement expected, string vectorName)
    {
        switch (expected.ValueKind)
        {
            case JsonValueKind.String:
                // Expected is a plain string
                var expectedStr = expected.GetString() ?? "";
                var actualStr = result?.ToString() ?? "";
                Assert.Equal(expectedStr, actualStr);
                break;

            case JsonValueKind.Array when expected.GetArrayLength() > 0 && expected[0].TryGetProperty("id", out _):
                // Expected is a ToolCall array
                Assert.IsType<ToolCallResult>(result);
                var tcr = (ToolCallResult)result;
                Assert.Equal(expected.GetArrayLength(), tcr.ToolCalls.Count);
                for (var i = 0; i < tcr.ToolCalls.Count; i++)
                {
                    var expTc = expected[i];
                    var actTc = tcr.ToolCalls[i];
                    Assert.Equal(expTc.GetProperty("id").GetString(), actTc.Id);
                    Assert.Equal(expTc.GetProperty("name").GetString(), actTc.Name);
                    // Normalize JSON whitespace for arguments comparison
                    var expectedArgs = NormalizeJson(expTc.GetProperty("arguments").GetString() ?? "");
                    var actualArgs = NormalizeJson(actTc.Arguments);
                    Assert.Equal(expectedArgs, actualArgs);
                }
                break;

            case JsonValueKind.Object:
                // Structured output — compare as JSON (semantic equality)
                Assert.IsType<StructuredResult>(result);
                var sr = (StructuredResult)result;
                var actualJson = JsonDocument.Parse(sr.RawJson).RootElement;
                AssertJsonEqual(expected, actualJson, vectorName);
                break;

            case JsonValueKind.Array:
                Assert.Fail($"[{vectorName}] Unexpected array result in non-tool-call context");
                break;

            default:
                Assert.Fail($"[{vectorName}] Unexpected expected type: {expected.ValueKind}");
                break;
        }
    }

    /// <summary>
    /// Compares two JsonElement values semantically (ignoring whitespace differences).
    /// </summary>
    private static void AssertJsonEqual(JsonElement expected, JsonElement actual, string context)
    {
        // Re-serialize both to normalized JSON
        var expectedNorm = NormalizeJson(expected.GetRawText());
        var actualNorm = NormalizeJson(actual.GetRawText());
        Assert.Equal(expectedNorm, actualNorm);
    }

    /// <summary>
    /// Normalizes JSON by deserializing and re-serializing to remove whitespace differences.
    /// </summary>
    private static string NormalizeJson(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return json;
        try
        {
            var elem = JsonSerializer.Deserialize<JsonElement>(json);
            return JsonSerializer.Serialize(elem);
        }
        catch
        {
            return json;
        }
    }

    /// <summary>
    /// Compares embedding results — handles single vector and batch vectors.
    /// </summary>
    private static void AssertEmbeddingsMatch(object result, JsonElement expected, string vectorName)
    {
        if (expected.ValueKind == JsonValueKind.Array && expected.GetArrayLength() > 0)
        {
            var firstEl = expected[0];
            if (firstEl.ValueKind == JsonValueKind.Array)
            {
                // Batch: list of vectors
                Assert.IsAssignableFrom<IList<float[]>>(result);
                var vectors = (IList<float[]>)result;
                Assert.Equal(expected.GetArrayLength(), vectors.Count);
                for (var i = 0; i < vectors.Count; i++)
                {
                    var expVec = expected[i];
                    Assert.Equal(expVec.GetArrayLength(), vectors[i].Length);
                    for (var j = 0; j < vectors[i].Length; j++)
                    {
                        Assert.Equal(expVec[j].GetSingle(), vectors[i][j], 4);
                    }
                }
            }
            else
            {
                // Single vector: flat float array
                Assert.IsType<float[]>(result);
                var vector = (float[])result;
                Assert.Equal(expected.GetArrayLength(), vector.Length);
                for (var i = 0; i < vector.Length; i++)
                {
                    Assert.Equal(expected[i].GetSingle(), vector[i], 4);
                }
            }
        }
    }
}
