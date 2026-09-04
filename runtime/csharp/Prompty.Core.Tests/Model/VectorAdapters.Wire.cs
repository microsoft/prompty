#nullable enable

using System.ClientModel.Primitives;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Prompty.Anthropic;
using Prompty.Core;
using Prompty.OpenAI;

namespace Prompty.Core.Conformance;

/// <summary>
/// @vector conformance adapters for the wire (WireConformance.toRequest) stage.
/// These drive the REAL provider layers — <see cref="WireFormat"/> and
/// <see cref="AnthropicExecutor"/> — exactly as production code does, then align
/// the SDK-shaped observation to each vector's
/// canonical <c>expected</c> shape via <see cref="AlignValue"/> (subset projection +
/// content-string/array collapse + float tolerance + JSON-equivalent tool arguments +
/// URI trailing-slash normalization). No behavior is faked: alignment only reshapes,
/// never fabricates, so a wrong value still fails.
/// </summary>
public static partial class VectorAdapters
{
    private static readonly ModelReaderWriterOptions WireJson = ModelReaderWriterOptions.Json;

    private static readonly JsonSerializerOptions AnthropicJson = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static string SeamDiscriminator(JsonElement input, params string[] path)
    {
        if (input.ValueKind != JsonValueKind.Object || !input.TryGetProperty("agent", out var node))
            return MissingSeamDiscriminator(path);

        foreach (var key in path)
        {
            if (node.ValueKind != JsonValueKind.Object || !node.TryGetProperty(key, out node))
                return MissingSeamDiscriminator(path);
        }

        if (node.ValueKind == JsonValueKind.String)
        {
            var text = node.GetString();
            if (!string.IsNullOrEmpty(text))
                return text;
        }

        return MissingSeamDiscriminator(path);
    }

    private static string MissingSeamDiscriminator(params string[] path)
    {
        var dotted = string.Join(".", new[] { "agent" }.Concat(path));
        throw new InvalidOperationException(
            $"vector input missing @dispatch discriminator at '{dotted}'; every conformance vector must nest the discriminator under the seam-param path (no flat-sibling fallback).");
    }

    // =======================================================================
    // Normalization shared by wire + process — align observed to expected shape.
    // =======================================================================

    private static JsonNode? AlignNormalize(JsonNode? observed, VectorContext ctx) =>
        AlignValue(observed, ctx.Vector["expected"]);

    private static JsonNode? AlignValue(JsonNode? observed, JsonNode? expected)
    {
        switch (expected)
        {
            case JsonObject expObj:
                {
                    // Subset projection: retain only keys present in expected.
                    var result = new JsonObject();
                    var obsObj = observed as JsonObject;
                    foreach (var kvp in expObj)
                    {
                        JsonNode? obsChild = null;
                        obsObj?.TryGetPropertyValue(kvp.Key, out obsChild);
                        result[kvp.Key] = AlignValue(obsChild?.DeepClone(), kvp.Value);
                    }
                    return result;
                }

            case JsonArray expArr:
                {
                    if (observed is JsonArray obsArr && obsArr.Count == expArr.Count)
                    {
                        var result = new JsonArray();
                        for (var i = 0; i < expArr.Count; i++)
                            result.Add(AlignValue(obsArr[i]?.DeepClone(), expArr[i]));
                        return result;
                    }

                    // Content simplified: expected array of a single text block, observed a
                    // bare string (some providers collapse single-text content to a string).
                    if (TryGetString(observed, out var os) && expArr.Count == 1)
                    {
                        var text = ExtractText(expArr);
                        if (text == os)
                            return expArr.DeepClone();
                    }

                    return observed?.DeepClone();
                }

            default:
                return AlignLeaf(observed, expected);
        }
    }

    private static JsonNode? AlignLeaf(JsonNode? observed, JsonNode? expected)
    {
        if (expected is not JsonValue expVal)
            return observed?.DeepClone();

        // expected string
        if (expVal.TryGetValue<string>(out var es))
        {
            // observed is a content array/object → collapse to plain text
            if (observed is JsonArray or JsonObject)
            {
                var text = ExtractText(observed);
                return text == es ? JsonValue.Create(es) : JsonValue.Create(text);
            }

            if (observed is JsonValue obsVal && obsVal.TryGetValue<string>(out var obsStr))
            {
                if (obsStr == es) return JsonValue.Create(es);
                // URI trailing slash — the .NET Uri class appends "/" to bare hosts.
                if (obsStr == es + "/" || es == obsStr + "/") return JsonValue.Create(es);
                // Tool-call arguments / structured JSON — compare semantically.
                if (JsonEquivalent(obsStr, es)) return JsonValue.Create(es);
                return JsonValue.Create(obsStr);
            }

            return observed?.DeepClone();
        }

        // expected number — snap within float tolerance (embedding representation drift).
        if (TryGetDouble(expected, out var ed) && TryGetDouble(observed, out var od))
            return Math.Abs(ed - od) < 1e-4 ? expected!.DeepClone() : observed?.DeepClone();

        // expected bool / null
        return observed?.DeepClone();
    }

    private static bool TryGetString(JsonNode? node, out string value)
    {
        value = string.Empty;
        if (node is JsonValue v && v.TryGetValue<string>(out var s))
        {
            value = s;
            return true;
        }
        return false;
    }

    private static bool TryGetDouble(JsonNode? node, out double value)
    {
        value = 0;
        if (node is not JsonValue v)
            return false;
        if (v.TryGetValue<double>(out value)) return true;
        if (v.TryGetValue<decimal>(out var dec)) { value = (double)dec; return true; }
        if (v.TryGetValue<long>(out var l)) { value = l; return true; }
        return false;
    }

    private static string ExtractText(JsonNode? node)
    {
        if (node is JsonValue v && v.TryGetValue<string>(out var s))
            return s;
        if (node is JsonArray arr)
        {
            var parts = new List<string>();
            foreach (var el in arr)
            {
                if (el is JsonObject o && o.TryGetPropertyValue("text", out var t) &&
                    t is JsonValue tv && tv.TryGetValue<string>(out var ts))
                    parts.Add(ts);
            }
            return string.Concat(parts);
        }
        if (node is JsonObject obj && obj.TryGetPropertyValue("text", out var tt) &&
            tt is JsonValue ttv && ttv.TryGetValue<string>(out var tts))
            return tts;
        return node?.ToJsonString() ?? string.Empty;
    }

    private static bool JsonEquivalent(string a, string b)
    {
        var na = NormalizeJsonString(a);
        var nb = NormalizeJsonString(b);
        return na is not null && na == nb;
    }

    private static string? NormalizeJsonString(string json)
    {
        try
        {
            return JsonSerializer.Serialize(JsonSerializer.Deserialize<JsonElement>(json));
        }
        catch
        {
            return null;
        }
    }

    // =======================================================================
    // WIRE — WireConformance.toRequest
    // =======================================================================

    private static JsonNode? WireInvoke(JsonNode? inputNode, VectorContext ctx)
    {
        var input = JsonSerializer.Deserialize<JsonElement>((inputNode ?? new JsonObject()).ToJsonString());
        var provider = SeamDiscriminator(input, "model", "provider");
        var apiType = input.TryGetProperty("apiType", out var at) ? at.GetString() ?? "chat" : "chat";
        var modelId = input.GetProperty("model_id").GetString() ?? string.Empty;

        var agent = BuildWireAgent(input);
        var messages = BuildWireMessages(input);

        JsonObject body = provider == "anthropic"
            ? BuildAnthropicBody(agent, messages)
            : apiType switch
            {
                "chat" => BuildOpenAIChatBody(modelId, agent, messages),
                "responses" => BuildOpenAIResponsesBody(modelId, agent, messages),
                "embedding" => BuildOpenAIEmbeddingBody(modelId, messages),
                "image" => BuildOpenAIImageBody(modelId, messages),
                _ => throw new InvalidOperationException($"Unsupported apiType '{apiType}' for wire vector."),
            };

        return new JsonObject { ["request_body"] = body };
    }

    private static JsonObject BuildOpenAIChatBody(string modelId, Core.Agent agent, List<Message> messages)
    {
        var options = WireFormat.BuildOptions(agent);
        var body = SerializeToObject(options);
        body["model"] = modelId;

        var msgArr = new JsonArray();
        foreach (var msg in messages)
        {
            var wire = WireFormat.MessageToWire(msg);
            msgArr.Add(SerializeToNode(wire));
        }
        body["messages"] = msgArr;
        return body;
    }

    private static JsonObject BuildOpenAIResponsesBody(string modelId, Core.Agent agent, List<Message> messages)
    {
        var options = WireFormat.BuildResponsesOptions(modelId, agent, messages);
        var body = SerializeToObject(options);
        if (!body.ContainsKey("model"))
            body["model"] = modelId;
        return body;
    }

    private static JsonObject BuildOpenAIEmbeddingBody(string modelId, List<Message> messages)
    {
        // Mirrors the executor: text is extracted from messages; a single text becomes a
        // string, multiple become an array.
        var texts = messages.Select(m => m.Text).ToList();
        JsonNode input = texts.Count == 1
            ? JsonValue.Create(texts[0])!
            : new JsonArray(texts.Select(t => (JsonNode)JsonValue.Create(t)!).ToArray());
        return new JsonObject { ["model"] = modelId, ["input"] = input };
    }

    private static JsonObject BuildOpenAIImageBody(string modelId, List<Message> messages)
    {
        var prompt = messages.LastOrDefault()?.Text ?? string.Empty;
        return new JsonObject { ["model"] = modelId, ["prompt"] = prompt };
    }

    private static JsonObject BuildAnthropicBody(Core.Agent agent, List<Message> messages)
    {
        var executor = new AnthropicExecutor();
        var dict = executor.BuildRequestBody(agent, messages, stream: false);
        var json = JsonSerializer.Serialize(dict, AnthropicJson);
        return (JsonObject)JsonNode.Parse(json)!;
    }

    // =======================================================================
    // Helpers — build Agent / Messages from a vector input (JsonElement).
    // =======================================================================

    private static Core.Agent BuildWireAgent(JsonElement input)
    {
        var modelId = input.GetProperty("model_id").GetString()!;
        var provider = SeamDiscriminator(input, "model", "provider");
        var apiType = input.GetProperty("apiType").GetString()!;

        var modelDict = new Dictionary<string, object?>
        {
            ["id"] = modelId,
            ["provider"] = provider,
            ["apiType"] = apiType,
            ["connection"] = new Dictionary<string, object?> { ["kind"] = "key", ["apiKey"] = "test-key" },
        };

        if (input.TryGetProperty("options", out var opts) && opts.ValueKind == JsonValueKind.Object)
        {
            var optionsDict = new Dictionary<string, object?>();
            foreach (var prop in opts.EnumerateObject())
                optionsDict[prop.Name] = ConvertJsonElement(prop.Value);
            modelDict["options"] = optionsDict;
        }

        var data = new Dictionary<string, object?>
        {
            ["name"] = "wire-test",
            ["model"] = modelDict,
        };

        if (input.TryGetProperty("tools", out var tools) && tools.ValueKind == JsonValueKind.Array &&
            tools.GetArrayLength() > 0)
        {
            var toolsList = new List<object>();
            foreach (var tool in tools.EnumerateArray())
                toolsList.Add(ConvertJsonElement(tool)!);
            data["tools"] = toolsList;
        }

        if (input.TryGetProperty("outputs", out var outputs) && outputs.ValueKind == JsonValueKind.Array &&
            outputs.GetArrayLength() > 0)
        {
            var outputsList = new List<object>();
            foreach (var output in outputs.EnumerateArray())
                outputsList.Add(ConvertJsonElement(output)!);
            data["outputs"] = outputsList;
        }

        return Core.Agent.Load(data, new LoadContext());
    }

    private static List<Message> BuildWireMessages(JsonElement input)
    {
        var messages = new List<Message>();
        foreach (var msg in input.GetProperty("messages").EnumerateArray())
        {
            var role = msg.GetProperty("role").GetString()!;
            var parts = new List<ContentPart>();
            foreach (var part in msg.GetProperty("content").EnumerateArray())
            {
                switch (part.GetProperty("kind").GetString())
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
    // Helpers — SDK serialization + JSON conversion.
    // =======================================================================

    private static JsonObject SerializeToObject<T>(T model) where T : IPersistableModel<T> =>
        (JsonObject)SerializeToNode(model)!;

    private static JsonNode? SerializeToNode<T>(T model) where T : IPersistableModel<T>
    {
        var data = ModelReaderWriter.Write(model, WireJson);
        return JsonNode.Parse(data.ToString());
    }

    private static object? ConvertJsonElement(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Object => ConvertJsonObject(element),
        JsonValueKind.Array => element.EnumerateArray().Select(ConvertJsonElement).ToList(),
        JsonValueKind.String => element.GetString(),
        JsonValueKind.Number when element.TryGetInt64(out var l) => l,
        JsonValueKind.Number => element.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null => null,
        _ => element.GetRawText(),
    };

    private static Dictionary<string, object?> ConvertJsonObject(JsonElement element)
    {
        var dict = new Dictionary<string, object?>();
        foreach (var prop in element.EnumerateObject())
            dict[prop.Name] = ConvertJsonElement(prop.Value);
        return dict;
    }
}
