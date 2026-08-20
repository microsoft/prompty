#nullable enable

using System.Reflection;
using System.Text.Json.Nodes;

namespace Prompty.Core;

public static class Discovery
{
    private const string CapabilityResourceName = "Prompty.Core.Data.model_capabilities.json";

    private static readonly Lazy<JsonObject> CapabilityData = new(LoadCapabilityData);

    public static ModelInfo Enrich(ModelInfo @base, string provider)
    {
        var entry = MatchCapabilities(@base.Id, provider);
        if (entry is null)
        {
            return @base;
        }

        if (@base.ContextWindow is null && entry.TryGetPropertyValue("contextWindow", out var contextWindow))
        {
            @base.ContextWindow = contextWindow?.GetValue<int>();
        }

        if (@base.InputModalities is null && entry.TryGetPropertyValue("inputModalities", out var inputModalities))
        {
            @base.InputModalities = ToStringList(inputModalities);
        }

        if (@base.OutputModalities is null && entry.TryGetPropertyValue("outputModalities", out var outputModalities))
        {
            @base.OutputModalities = ToStringList(outputModalities);
        }

        return @base;
    }

    public static ModelInfo MapModel(JsonNode? raw, string provider)
    {
        var data = raw as JsonObject ?? new JsonObject();
        var info = new ModelInfo
        {
            AdditionalProperties = ToObjectDictionary(data),
        };

        switch (provider)
        {
            case "anthropic":
                SetString(data, "id", value => info.Id = value);
                SetString(data, "display_name", value => info.DisplayName = value);
                info.OwnedBy = "anthropic";
                SetInt(data, "context_length", value => info.ContextWindow = value);
                SetStringList(data, "input_modalities", value => info.InputModalities = value);
                SetStringList(data, "output_modalities", value => info.OutputModalities = value);
                break;

            case "foundry":
                MapFoundryModel(data, info);
                break;

            default:
                SetString(data, "id", value => info.Id = value);
                SetString(data, "owned_by", value => info.OwnedBy = value);
                break;
        }

        if (info.Id is null)
        {
            info.Id = string.Empty;
        }

        return info;
    }

    private static void MapFoundryModel(JsonObject data, ModelInfo info)
    {
        if (data.TryGetPropertyValue("properties", out var propertiesNode) && propertiesNode is JsonObject properties)
        {
            var model = properties["model"] as JsonObject;
            var capabilities = properties["capabilities"] as JsonObject;

            SetString(data, "name", value => info.Id = value);
            SetString(model, "name", value => info.DisplayName = value);
            SetString(model, "publisher", value => info.OwnedBy = value);
            SetInt(model, "maxContextLength", value => info.ContextWindow = value);
            SetStringList(capabilities, "supportedInputModalities", value => info.InputModalities = value);
            SetStringList(capabilities, "supportedOutputModalities", value => info.OutputModalities = value);
            return;
        }

        if (data.ContainsKey("modelName") || StringEquals(data, "type", "ModelDeployment"))
        {
            SetString(data, "name", value => info.Id = value);
            SetString(data, "modelName", value => info.DisplayName = value);
            SetString(data, "modelPublisher", value => info.OwnedBy = value);
            SetInt(data, "maxContextLength", value => info.ContextWindow = value);
            return;
        }

        SetString(data, "id", value => info.Id = value);
        SetString(data, "owned_by", value => info.OwnedBy = value);
        SetInt(data, "maxContextLength", value => info.ContextWindow = value);
    }

    private static JsonObject? MatchCapabilities(string modelId, string provider)
    {
        var providers = CapabilityData.Value["providers"] as JsonObject;
        if (providers?[provider] is not JsonArray entries)
        {
            return null;
        }

        JsonObject? best = null;
        var bestLength = -1;
        foreach (var entryNode in entries)
        {
            if (entryNode is not JsonObject entry)
            {
                continue;
            }

            var prefix = (string?)entry["prefix"];
            if (string.IsNullOrEmpty(prefix) || !MatchesTokenBoundary(modelId, prefix))
            {
                continue;
            }

            if (prefix.Length > bestLength)
            {
                best = entry;
                bestLength = prefix.Length;
            }
        }

        return best;
    }

    private static bool MatchesTokenBoundary(string modelId, string prefix)
    {
        if (modelId == prefix)
        {
            return true;
        }

        return modelId.StartsWith(prefix, StringComparison.Ordinal) &&
            modelId.Length > prefix.Length &&
            !char.IsLetterOrDigit(modelId[prefix.Length]);
    }

    private static JsonObject LoadCapabilityData()
    {
        var assembly = typeof(Discovery).Assembly;
        using var stream = assembly.GetManifestResourceStream(CapabilityResourceName)
            ?? throw new InvalidOperationException($"Embedded resource '{CapabilityResourceName}' was not found.");
        using var reader = new StreamReader(stream);
        return JsonNode.Parse(reader.ReadToEnd()) as JsonObject
            ?? throw new InvalidOperationException("Model capability data must be a JSON object.");
    }

    private static void SetString(JsonObject? data, string key, Action<string> set)
    {
        if (data?.TryGetPropertyValue(key, out var value) == true && value is not null)
        {
            set(value.GetValue<string>());
        }
    }

    private static void SetInt(JsonObject? data, string key, Action<int> set)
    {
        if (data?.TryGetPropertyValue(key, out var value) == true && value is not null)
        {
            set(value.GetValue<int>());
        }
    }

    private static void SetStringList(JsonObject? data, string key, Action<IList<string>> set)
    {
        if (data?.TryGetPropertyValue(key, out var value) == true && value is not null)
        {
            set(ToStringList(value));
        }
    }

    private static bool StringEquals(JsonObject data, string key, string expected) =>
        data.TryGetPropertyValue(key, out var value) &&
        value is not null &&
        string.Equals(value.GetValue<string>(), expected, StringComparison.Ordinal);

    private static IList<string> ToStringList(JsonNode? node)
    {
        if (node is not JsonArray array)
        {
            return [];
        }

        return array
            .Select(item => item?.GetValue<string>() ?? string.Empty)
            .ToList();
    }

    private static Dictionary<string, object?> ToObjectDictionary(JsonObject obj) =>
        obj.ToDictionary(kvp => kvp.Key, kvp => ToObject(kvp.Value));

    private static object? ToObject(JsonNode? node)
    {
        return node switch
        {
            null => null,
            JsonObject obj => ToObjectDictionary(obj),
            JsonArray arr => arr.Select(ToObject).ToList(),
            JsonValue value => ToPrimitive(value),
            _ => null,
        };
    }

    private static object? ToPrimitive(JsonValue value)
    {
        if (value.TryGetValue<string>(out var stringValue))
        {
            return stringValue;
        }

        if (value.TryGetValue<bool>(out var boolValue))
        {
            return boolValue;
        }

        if (value.TryGetValue<int>(out var intValue))
        {
            return intValue;
        }

        if (value.TryGetValue<long>(out var longValue))
        {
            return longValue;
        }

        if (value.TryGetValue<double>(out var doubleValue))
        {
            return doubleValue;
        }

        return value.GetValue<object?>();
    }
}
