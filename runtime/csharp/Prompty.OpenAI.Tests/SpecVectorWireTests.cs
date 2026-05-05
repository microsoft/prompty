// Copyright (c) Microsoft. All rights reserved.

#pragma warning disable OPENAI001 // Responses API is in preview

using System.ClientModel.Primitives;
using System.Text.Json;
using OpenAI.Chat;
using OpenAI.Responses;
using Prompty.Core;
using Prompty.OpenAI;
using Prompty.Anthropic;

namespace Prompty.OpenAI.Tests;

/// <summary>
/// Spec vector tests for the wire stage — loads canonical vectors from
/// spec/vectors/wire/wire_vectors.json and verifies that the C# runtime
/// produces correct JSON payloads for LLM API requests.
///
/// For OpenAI: tests use ModelReaderWriter to serialize SDK types and
/// compare against expected JSON via semantic (subset) matching.
///
/// For Anthropic: tests call BuildRequestBody (internal) and compare
/// the full serialized body against expected JSON.
/// </summary>
public class SpecVectorWireTests
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
        var path = Path.Combine(VectorsDir, "wire", "wire_vectors.json");
        return JsonSerializer.Deserialize<JsonElement[]>(File.ReadAllText(path)) ?? [];
    }

    // =======================================================================
    // OpenAI Chat — full request body comparison via ChatCompletionOptions
    // =======================================================================

    [Theory]
    [MemberData(nameof(OpenAIChatVectors))]
    public void OpenAI_Chat_WireFormat(string name, JsonElement input, JsonElement expectedBody)
    {
        var agent = BuildAgentFromVector(input);
        var messages = BuildMessages(input);

        // Build wire messages
        var wireMessages = messages.Select(WireFormat.MessageToWire).ToList();

        // Build options (includes tools, response_format, etc.)
        var options = WireFormat.BuildOptions(agent);

        // Serialize the ChatCompletionOptions via ModelReaderWriter — this gives us the full body
        var optionsData = ModelReaderWriter.Write(options, ModelReaderWriterOptions.Json);
        var optionsJson = JsonDocument.Parse(optionsData.ToStream()).RootElement;

        // Serialize each message
        var serializedMessages = new List<JsonElement>();
        foreach (var msg in wireMessages)
        {
            var msgData = ModelReaderWriter.Write(msg, ModelReaderWriterOptions.Json);
            var msgJson = JsonDocument.Parse(msgData.ToStream()).RootElement;
            serializedMessages.Add(msgJson);
        }

        // Now compare fields from the expected body

        // 1. Check model
        if (expectedBody.TryGetProperty("model", out var expectedModel))
        {
            // Model is not in ChatCompletionOptions serialization, it's set at call time.
            // We verify the agent has the right model.
            Assert.Equal(expectedModel.GetString(), agent.Model?.Id);
        }

        // 2. Check messages
        if (expectedBody.TryGetProperty("messages", out var expectedMessages))
        {
            Assert.Equal(expectedMessages.GetArrayLength(), serializedMessages.Count);
            for (int i = 0; i < serializedMessages.Count; i++)
            {
                var actual = serializedMessages[i];
                var expected = expectedMessages[i];
                AssertMessageMatches(actual, expected, $"[{name}] messages[{i}]");
            }
        }

        // 3. Check tools
        if (expectedBody.TryGetProperty("tools", out var expectedTools))
        {
            // The serialized options should contain tools
            Assert.True(optionsJson.TryGetProperty("tools", out var actualTools),
                $"[{name}] Expected 'tools' in serialized options but not found");
            Assert.Equal(expectedTools.GetArrayLength(), actualTools.GetArrayLength());
            for (int i = 0; i < expectedTools.GetArrayLength(); i++)
            {
                AssertJsonSubset(expectedTools[i], actualTools[i], $"[{name}] tools[{i}]");
            }
        }
        else
        {
            // If no tools expected, verify none are present
            if (optionsJson.TryGetProperty("tools", out var actualTools))
            {
                Assert.Equal(0, actualTools.GetArrayLength());
            }
        }

        // 4. Check options (temperature, max_completion_tokens, etc.)
        AssertOptionFields(optionsJson, expectedBody, name);

        // 5. Check response_format (structured output)
        if (expectedBody.TryGetProperty("response_format", out var expectedRF))
        {
            Assert.True(optionsJson.TryGetProperty("response_format", out var actualRF),
                $"[{name}] Expected 'response_format' in serialized options but not found");
            AssertJsonSubset(expectedRF, actualRF, $"[{name}] response_format");
        }
    }

    public static IEnumerable<object[]> OpenAIChatVectors()
    {
        foreach (var vec in Vectors)
        {
            var input = vec.GetProperty("input");
            var provider = input.GetProperty("provider").GetString();
            var apiType = input.GetProperty("apiType").GetString();
            if (provider != "openai") continue;
            if (apiType != "chat") continue;

            var name = vec.GetProperty("name").GetString()!;

            // Skip vectors that require features not yet implemented in C#
            if (name is "chat_audio_part" or "chat_audio_mp3")
                continue; // AudioPart not handled in WireFormat.BuildContentParts

            if (name == "options_additional_properties")
                continue; // AdditionalProperties passthrough not implemented in BuildOptions

            yield return [name, input, vec.GetProperty("expected").GetProperty("request_body")];
        }
    }

    // =======================================================================
    // OpenAI Embedding — verify text extraction
    // =======================================================================

    [Theory]
    [MemberData(nameof(OpenAIEmbeddingVectors))]
#pragma warning disable xUnit1026 // Theory method parameter is used for test display name
    public void OpenAI_Embedding_WireFormat(string _name, JsonElement input, JsonElement expectedBody)
#pragma warning restore xUnit1026
    {
        var messages = BuildMessages(input);

        // The executor extracts text from messages for embedding
        var texts = messages.Select(m => m.Text).ToList();

        // Expected body has "input" field
        var expectedInput = expectedBody.GetProperty("input");

        if (expectedInput.ValueKind == JsonValueKind.String)
        {
            // Single input
            Assert.Single(texts);
            Assert.Equal(expectedInput.GetString(), texts[0]);
        }
        else if (expectedInput.ValueKind == JsonValueKind.Array)
        {
            Assert.Equal(expectedInput.GetArrayLength(), texts.Count);
            for (int i = 0; i < texts.Count; i++)
            {
                Assert.Equal(expectedInput[i].GetString(), texts[i]);
            }
        }

        // Verify model
        if (expectedBody.TryGetProperty("model", out var expectedModel))
        {
            var modelId = input.GetProperty("model_id").GetString();
            Assert.Equal(expectedModel.GetString(), modelId);
        }
    }

    public static IEnumerable<object[]> OpenAIEmbeddingVectors()
    {
        foreach (var vec in Vectors)
        {
            var input = vec.GetProperty("input");
            var provider = input.GetProperty("provider").GetString();
            var apiType = input.GetProperty("apiType").GetString();
            if (provider != "openai") continue;
            if (apiType != "embedding") continue;

            yield return [
                vec.GetProperty("name").GetString()!,
                input,
                vec.GetProperty("expected").GetProperty("request_body"),
            ];
        }
    }

    // =======================================================================
    // OpenAI Image — verify prompt extraction
    // =======================================================================

    [Theory]
    [MemberData(nameof(OpenAIImageVectors))]
#pragma warning disable xUnit1026 // Theory method parameter is used for test display name
    public void OpenAI_Image_WireFormat(string _name, JsonElement input, JsonElement expectedBody)
#pragma warning restore xUnit1026
    {
        var messages = BuildMessages(input);

        // The executor uses the last user message as the prompt
        var prompt = messages.LastOrDefault()?.Text ?? "";

        var expectedPrompt = expectedBody.GetProperty("prompt").GetString();
        Assert.Equal(expectedPrompt, prompt);

        // Verify model
        if (expectedBody.TryGetProperty("model", out var expectedModel))
        {
            var modelId = input.GetProperty("model_id").GetString();
            Assert.Equal(expectedModel.GetString(), modelId);
        }
    }

    public static IEnumerable<object[]> OpenAIImageVectors()
    {
        foreach (var vec in Vectors)
        {
            var input = vec.GetProperty("input");
            var provider = input.GetProperty("provider").GetString();
            var apiType = input.GetProperty("apiType").GetString();
            if (provider != "openai") continue;
            if (apiType != "image") continue;

            yield return [
                vec.GetProperty("name").GetString()!,
                input,
                vec.GetProperty("expected").GetProperty("request_body"),
            ];
        }
    }

    // =======================================================================
    // OpenAI Responses — full request body via CreateResponseOptions
    // =======================================================================

    [Theory]
    [MemberData(nameof(OpenAIResponsesVectors))]
    public void OpenAI_Responses_WireFormat(string name, JsonElement input, JsonElement expectedBody)
    {
        var agent = BuildAgentFromVector(input);
        var messages = BuildMessages(input);
        var model = input.GetProperty("model_id").GetString()!;

        var options = WireFormat.BuildResponsesOptions(model, agent, messages);

        // Serialize via ModelReaderWriter
        var optionsData = ModelReaderWriter.Write(options, ModelReaderWriterOptions.Json);
        var actualJson = JsonDocument.Parse(optionsData.ToStream()).RootElement;

        // Compare model
        if (expectedBody.TryGetProperty("model", out var expectedModel))
        {
            Assert.True(actualJson.TryGetProperty("model", out var actualModel),
                $"[{name}] Expected 'model' in serialized options");
            Assert.Equal(expectedModel.GetString(), actualModel.GetString());
        }

        // Compare instructions
        if (expectedBody.TryGetProperty("instructions", out var expectedInstructions))
        {
            Assert.True(actualJson.TryGetProperty("instructions", out var actualInstructions),
                $"[{name}] Expected 'instructions' in serialized options");
            Assert.Equal(expectedInstructions.GetString(), actualInstructions.GetString());
        }

        // Compare input items semantically — the SDK wraps items with extra fields
        // (e.g., type: "message", content: [{type: "input_text", text: "..."}])
        // while vectors use the simpler form (role: "user", content: "Hello").
        if (expectedBody.TryGetProperty("input", out var expectedInput))
        {
            Assert.True(actualJson.TryGetProperty("input", out var actualInput),
                $"[{name}] Expected 'input' in serialized options");
            Assert.Equal(expectedInput.GetArrayLength(), actualInput.GetArrayLength());
            for (int i = 0; i < expectedInput.GetArrayLength(); i++)
            {
                AssertResponsesInputItemMatches(actualInput[i], expectedInput[i], $"[{name}] input[{i}]");
            }
        }

        // Compare tools — the SDK may add extra fields like 'strict: false'
        if (expectedBody.TryGetProperty("tools", out var expectedTools))
        {
            Assert.True(actualJson.TryGetProperty("tools", out var actualTools),
                $"[{name}] Expected 'tools' in serialized options");
            Assert.Equal(expectedTools.GetArrayLength(), actualTools.GetArrayLength());
            for (int i = 0; i < expectedTools.GetArrayLength(); i++)
            {
                AssertJsonSubset(expectedTools[i], actualTools[i], $"[{name}] tools[{i}]");
            }
        }

        // Compare text (structured output)
        if (expectedBody.TryGetProperty("text", out var expectedText))
        {
            Assert.True(actualJson.TryGetProperty("text", out var actualText),
                $"[{name}] Expected 'text' in serialized options");
            AssertJsonSubset(expectedText, actualText, $"[{name}] text");
        }
    }

    public static IEnumerable<object[]> OpenAIResponsesVectors()
    {
        foreach (var vec in Vectors)
        {
            var input = vec.GetProperty("input");
            var provider = input.GetProperty("provider").GetString();
            var apiType = input.GetProperty("apiType").GetString();
            if (provider != "openai") continue;
            if (apiType != "responses") continue;

            yield return [
                vec.GetProperty("name").GetString()!,
                input,
                vec.GetProperty("expected").GetProperty("request_body"),
            ];
        }
    }

    // =======================================================================
    // Anthropic — full request body comparison
    // =======================================================================

    [Theory]
    [MemberData(nameof(AnthropicChatVectors))]
    public void Anthropic_Chat_WireFormat(string name, JsonElement input, JsonElement expectedBody)
    {
        var agent = BuildAgentFromVector(input);
        var messages = BuildMessages(input);

        // BuildRequestBody is internal — accessible via InternalsVisibleTo
        var executor = new AnthropicExecutor();
        var body = executor.BuildRequestBody(agent, messages, stream: false);

        // Serialize to JSON for comparison
        var bodyJson = JsonSerializer.SerializeToElement(body, new JsonSerializerOptions
        {
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
        });

        // Compare each expected field individually, using content-aware comparison for messages
        foreach (var prop in expectedBody.EnumerateObject())
        {
            Assert.True(bodyJson.TryGetProperty(prop.Name, out var actualProp),
                $"[{name}]: missing key '{prop.Name}' in actual body. Actual: {bodyJson.GetRawText()}");

            if (prop.Name == "messages")
            {
                // Messages need special handling for content simplification:
                // The runtime may simplify single-text content to a string while vectors use array form.
                Assert.Equal(prop.Value.GetArrayLength(), actualProp.GetArrayLength());
                for (int i = 0; i < prop.Value.GetArrayLength(); i++)
                {
                    AssertAnthropicMessageMatches(actualProp[i], prop.Value[i], $"[{name}] messages[{i}]");
                }
            }
            else
            {
                AssertJsonSubset(prop.Value, actualProp, $"[{name}].{prop.Name}");
            }
        }
    }

    public static IEnumerable<object[]> AnthropicChatVectors()
    {
        foreach (var vec in Vectors)
        {
            var input = vec.GetProperty("input");
            var provider = input.GetProperty("provider").GetString();
            if (provider != "anthropic") continue;

            yield return [
                vec.GetProperty("name").GetString()!,
                input,
                vec.GetProperty("expected").GetProperty("request_body"),
            ];
        }
    }

    // =======================================================================
    // Helpers — Agent and Message construction from vectors
    // =======================================================================

    /// <summary>
    /// Builds a Core.Prompty agent from a wire vector's input data.
    /// </summary>
    private static Core.Prompty BuildAgentFromVector(JsonElement input)
    {
        var modelId = input.GetProperty("model_id").GetString()!;
        var provider = input.GetProperty("provider").GetString()!;
        var apiType = input.GetProperty("apiType").GetString()!;

        var modelDict = new Dictionary<string, object?>
        {
            ["id"] = modelId,
            ["provider"] = provider,
            ["apiType"] = apiType,
            ["connection"] = new Dictionary<string, object?> { ["kind"] = "key", ["apiKey"] = "test-key" },
        };

        // Add options if present
        if (input.TryGetProperty("options", out var opts) && opts.ValueKind == JsonValueKind.Object)
        {
            var optionsDict = new Dictionary<string, object?>();
            foreach (var prop in opts.EnumerateObject())
            {
                optionsDict[prop.Name] = ConvertJsonElement(prop.Value);
            }
            modelDict["options"] = optionsDict;
        }

        var data = new Dictionary<string, object?>
        {
            ["name"] = "wire-test",
            ["model"] = modelDict,
        };

        // Add tools
        if (input.TryGetProperty("tools", out var tools) && tools.GetArrayLength() > 0)
        {
            var toolsList = new List<object>();
            foreach (var tool in tools.EnumerateArray())
            {
                toolsList.Add(ConvertJsonElement(tool)!);
            }
            data["tools"] = toolsList;
        }

        // Add outputs
        if (input.TryGetProperty("outputs", out var outputs) && outputs.GetArrayLength() > 0)
        {
            var outputsList = new List<object>();
            foreach (var output in outputs.EnumerateArray())
            {
                outputsList.Add(ConvertJsonElement(output)!);
            }
            data["outputs"] = outputsList;
        }

        return Core.Prompty.Load(data, new LoadContext());
    }

    /// <summary>
    /// Builds a list of Message from a wire vector's input data.
    /// </summary>
    private static List<Message> BuildMessages(JsonElement input)
    {
        var messages = new List<Message>();
        foreach (var msg in input.GetProperty("messages").EnumerateArray())
        {
            var role = msg.GetProperty("role").GetString()!;
            var parts = new List<ContentPart>();
            foreach (var part in msg.GetProperty("content").EnumerateArray())
            {
                var kind = part.GetProperty("kind").GetString();
                switch (kind)
                {
                    case "text":
                        parts.Add(new TextPart { Value = part.GetProperty("value").GetString()! });
                        break;
                    case "image":
                        var imgPart = new ImagePart { Source = part.GetProperty("value").GetString()! };
                        if (part.TryGetProperty("mediaType", out var mt))
                            imgPart.MediaType = mt.GetString();
                        if (part.TryGetProperty("detail", out var d))
                            imgPart.Detail = d.GetString();
                        parts.Add(imgPart);
                        break;
                    case "audio":
                        var audioPart = new AudioPart { Source = part.GetProperty("value").GetString()! };
                        if (part.TryGetProperty("mediaType", out var audioMt))
                            audioPart.MediaType = audioMt.GetString();
                        parts.Add(audioPart);
                        break;
                }
            }
            messages.Add(new Message { Role = Enum.Parse<Role>(role, true), Parts = parts });
        }
        return messages;
    }

    // =======================================================================
    // Helpers — JSON comparison
    // =======================================================================

    /// <summary>
    /// Asserts that all keys in 'expected' exist in 'actual' with matching values.
    /// Extra keys in 'actual' are allowed (the SDK may add defaults).
    /// </summary>
    private static void AssertJsonSubset(JsonElement expected, JsonElement actual, string context)
    {
        if (expected.ValueKind != actual.ValueKind)
        {
            // Special case: expected number vs actual number with different representation
            if (expected.ValueKind == JsonValueKind.Number && actual.ValueKind == JsonValueKind.Number)
            {
                Assert.Equal(expected.GetDecimal(), actual.GetDecimal());
                return;
            }
            Assert.Fail($"{context}: expected ValueKind {expected.ValueKind} but got {actual.ValueKind}. " +
                $"Expected: {expected.GetRawText()}, Actual: {actual.GetRawText()}");
        }

        switch (expected.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var prop in expected.EnumerateObject())
                {
                    Assert.True(actual.TryGetProperty(prop.Name, out var actualProp),
                        $"{context}: missing key '{prop.Name}' in actual. Actual: {actual.GetRawText()}");
                    AssertJsonSubset(prop.Value, actualProp, $"{context}.{prop.Name}");
                }
                break;

            case JsonValueKind.Array:
                Assert.Equal(expected.GetArrayLength(), actual.GetArrayLength());
                for (int i = 0; i < expected.GetArrayLength(); i++)
                {
                    AssertJsonSubset(expected[i], actual[i], $"{context}[{i}]");
                }
                break;

            case JsonValueKind.String:
                AssertStringsEquivalent(expected.GetString()!, actual.GetString()!, context);
                break;

            case JsonValueKind.Number:
                Assert.Equal(expected.GetDecimal(), actual.GetDecimal());
                break;

            case JsonValueKind.True:
            case JsonValueKind.False:
                Assert.Equal(expected.GetBoolean(), actual.GetBoolean());
                break;

            case JsonValueKind.Null:
                break;

            default:
                Assert.Fail($"{context}: unexpected ValueKind {expected.ValueKind}");
                break;
        }
    }

    /// <summary>
    /// Compares strings with URI normalization — the .NET Uri class may add trailing
    /// slashes to bare-host URLs (e.g., "https://img.png" → "https://img.png/").
    /// </summary>
    private static void AssertStringsEquivalent(string expected, string actual, string context)
    {
        if (expected == actual) return;

        // Normalize trailing slash for URLs — Uri class adds "/" to bare hosts
        if (Uri.TryCreate(expected, UriKind.Absolute, out _) && actual == expected + "/")
            return;
        if (Uri.TryCreate(actual, UriKind.Absolute, out _) && expected == actual + "/")
            return;

        Assert.Fail($"{context}: expected string '{expected}' but got '{actual}'");
    }

    /// <summary>
    /// Verifies a serialized ChatMessage matches the expected message JSON.
    /// Handles both string content and array content forms.
    /// </summary>
    private static void AssertMessageMatches(JsonElement actual, JsonElement expected, string context)
    {
        // Check role
        if (expected.TryGetProperty("role", out var expectedRole))
        {
            Assert.True(actual.TryGetProperty("role", out var actualRole),
                $"{context}: missing 'role' in actual message");
            Assert.Equal(expectedRole.GetString(), actualRole.GetString());
        }

        // Check content
        if (expected.TryGetProperty("content", out var expectedContent))
        {
            Assert.True(actual.TryGetProperty("content", out var actualContent),
                $"{context}: missing 'content' in actual message. Actual: {actual.GetRawText()}");

            if (expectedContent.ValueKind == JsonValueKind.String)
            {
                // Expected plain string content
                if (actualContent.ValueKind == JsonValueKind.String)
                {
                    Assert.Equal(expectedContent.GetString(), actualContent.GetString());
                }
                else if (actualContent.ValueKind == JsonValueKind.Array && actualContent.GetArrayLength() == 1)
                {
                    // SDK may serialize as single-element array — extract text
                    var firstPart = actualContent[0];
                    if (firstPart.TryGetProperty("text", out var textProp))
                    {
                        Assert.Equal(expectedContent.GetString(), textProp.GetString());
                    }
                    else
                    {
                        Assert.Fail($"{context}: expected string content '{expectedContent.GetString()}' " +
                            $"but got array: {actualContent.GetRawText()}");
                    }
                }
                else
                {
                    Assert.Fail($"{context}: expected string content but got {actualContent.ValueKind}: " +
                        $"{actualContent.GetRawText()}");
                }
            }
            else if (expectedContent.ValueKind == JsonValueKind.Array)
            {
                // Expected array of content parts
                Assert.Equal(JsonValueKind.Array, actualContent.ValueKind);
                Assert.Equal(expectedContent.GetArrayLength(), actualContent.GetArrayLength());
                for (int i = 0; i < expectedContent.GetArrayLength(); i++)
                {
                    AssertJsonSubset(expectedContent[i], actualContent[i],
                        $"{context}.content[{i}]");
                }
            }
        }
    }

    /// <summary>
    /// Compares an Anthropic message where the runtime may simplify single-text content
    /// to a string (e.g., "content": "Hello") while vectors use the array form
    /// (e.g., "content": [{"type": "text", "text": "Hello"}]).
    /// </summary>
    private static void AssertAnthropicMessageMatches(JsonElement actual, JsonElement expected, string context)
    {
        // Check role
        if (expected.TryGetProperty("role", out var expectedRole))
        {
            Assert.True(actual.TryGetProperty("role", out var actualRole),
                $"{context}: missing 'role' in actual. Actual: {actual.GetRawText()}");
            Assert.Equal(expectedRole.GetString(), actualRole.GetString());
        }

        // Check content with simplification handling
        if (expected.TryGetProperty("content", out var expectedContent))
        {
            Assert.True(actual.TryGetProperty("content", out var actualContent),
                $"{context}: missing 'content' in actual. Actual: {actual.GetRawText()}");

            if (expectedContent.ValueKind == JsonValueKind.Array && actualContent.ValueKind == JsonValueKind.String)
            {
                // Runtime simplified: expected array with single text, actual is string
                if (expectedContent.GetArrayLength() == 1)
                {
                    var part = expectedContent[0];
                    if (part.TryGetProperty("text", out var textProp))
                    {
                        Assert.Equal(textProp.GetString(), actualContent.GetString());
                        return;
                    }
                }
                Assert.Fail($"{context}: expected array content but got simplified string '{actualContent.GetString()}'");
            }
            else if (expectedContent.ValueKind == JsonValueKind.String && actualContent.ValueKind == JsonValueKind.Array)
            {
                // Opposite: expected string, actual array
                if (actualContent.GetArrayLength() == 1)
                {
                    var part = actualContent[0];
                    if (part.TryGetProperty("text", out var textProp))
                    {
                        Assert.Equal(expectedContent.GetString(), textProp.GetString());
                        return;
                    }
                }
                Assert.Fail($"{context}: expected string content but got array: {actualContent.GetRawText()}");
            }
            else
            {
                // Same kind — use standard comparison
                AssertJsonSubset(expectedContent, actualContent, $"{context}.content");
            }
        }
    }

    /// <summary>
    /// Compares a Responses API input item. The SDK serializes items with extra fields
    /// (type: "message", content: [{type: "input_text", text: "..."}]) while vectors
    /// use the simpler form ({role: "user", content: "Hello"}).
    /// This extracts the semantic content (role + text) and compares those.
    /// </summary>
    private static void AssertResponsesInputItemMatches(JsonElement actual, JsonElement expected, string context)
    {
        // Compare role
        if (expected.TryGetProperty("role", out var expectedRole))
        {
            Assert.True(actual.TryGetProperty("role", out var actualRole),
                $"{context}: missing 'role' in actual. Actual: {actual.GetRawText()}");
            Assert.Equal(expectedRole.GetString(), actualRole.GetString());
        }

        // Compare content semantically
        if (expected.TryGetProperty("content", out var expectedContent))
        {
            Assert.True(actual.TryGetProperty("content", out var actualContent),
                $"{context}: missing 'content' in actual. Actual: {actual.GetRawText()}");

            // Extract the text from expected (may be string or array)
            var expectedText = ExtractTextContent(expectedContent);

            // Extract text from actual (SDK uses array with input_text type)
            var actualText = ExtractTextContent(actualContent);

            Assert.Equal(expectedText, actualText);
        }
    }

    /// <summary>
    /// Extracts plain text from a content field that may be a string or an array of parts.
    /// </summary>
    private static string ExtractTextContent(JsonElement content)
    {
        if (content.ValueKind == JsonValueKind.String)
            return content.GetString() ?? "";

        if (content.ValueKind == JsonValueKind.Array && content.GetArrayLength() > 0)
        {
            var parts = new List<string>();
            foreach (var part in content.EnumerateArray())
            {
                if (part.TryGetProperty("text", out var text))
                    parts.Add(text.GetString() ?? "");
            }
            return string.Join("", parts);
        }

        return content.GetRawText();
    }

    /// <summary>
    /// Asserts that model option fields in the serialized body match expected values.
    /// </summary>
    private static void AssertOptionFields(JsonElement optionsJson, JsonElement expectedBody, string vectorName)
    {
        // Map of expected body keys to their option serialization keys
        var optionMap = new Dictionary<string, string>
        {
            ["temperature"] = "temperature",
            ["max_completion_tokens"] = "max_completion_tokens",
            ["top_p"] = "top_p",
            ["frequency_penalty"] = "frequency_penalty",
            ["presence_penalty"] = "presence_penalty",
            ["seed"] = "seed",
            ["stop"] = "stop",
        };

        foreach (var (expectedKey, optionsKey) in optionMap)
        {
            if (expectedBody.TryGetProperty(expectedKey, out var expectedVal))
            {
                Assert.True(optionsJson.TryGetProperty(optionsKey, out var actualVal),
                    $"[{vectorName}] Expected option '{optionsKey}' but not found in serialized options. " +
                    $"Options: {optionsJson.GetRawText()}");

                if (expectedVal.ValueKind == JsonValueKind.Array)
                {
                    Assert.Equal(expectedVal.GetArrayLength(), actualVal.GetArrayLength());
                    for (int i = 0; i < expectedVal.GetArrayLength(); i++)
                    {
                        AssertJsonSubset(expectedVal[i], actualVal[i], $"[{vectorName}] {optionsKey}[{i}]");
                    }
                }
                else
                {
                    AssertJsonSubset(expectedVal, actualVal, $"[{vectorName}] {optionsKey}");
                }
            }
        }
    }

    /// <summary>
    /// Recursively converts a JsonElement to a CLR object suitable for dictionary-based loading.
    /// </summary>
    private static object? ConvertJsonElement(JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.Object => ConvertJsonObject(element),
            JsonValueKind.Array => ConvertJsonArray(element),
            JsonValueKind.String => element.GetString(),
            JsonValueKind.Number when element.TryGetInt64(out var l) => l,
            JsonValueKind.Number => element.GetDouble(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Null => null,
            _ => element.GetRawText(),
        };
    }

    private static Dictionary<string, object?> ConvertJsonObject(JsonElement element)
    {
        var dict = new Dictionary<string, object?>();
        foreach (var prop in element.EnumerateObject())
        {
            dict[prop.Name] = ConvertJsonElement(prop.Value);
        }
        return dict;
    }

    private static List<object> ConvertJsonArray(JsonElement element)
    {
        var list = new List<object>();
        foreach (var item in element.EnumerateArray())
        {
            list.Add(ConvertJsonElement(item)!);
        }
        return list;
    }
}
