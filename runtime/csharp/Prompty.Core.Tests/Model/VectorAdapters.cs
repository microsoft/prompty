#nullable enable

using System.Text.Json;
using System.Text.Json.Nodes;
using Prompty.Core;

namespace Prompty.Core.Conformance;

public sealed class VectorAdapter(Func<JsonNode?, VectorContext, JsonNode?> invoke, Func<JsonNode?, VectorContext, JsonNode?>? normalize = null)
{
    private readonly Func<JsonNode?, VectorContext, JsonNode?> invoke = invoke;

    public Func<JsonNode?, VectorContext, JsonNode?>? Normalize { get; } = normalize;

    public JsonNode? Invoke(JsonNode? input, VectorContext ctx) => invoke(input, ctx);
}

public sealed class VectorContext
{
    public string Contract { get; init; } = string.Empty;

    public string Operation { get; init; } = string.Empty;

    public JsonNode Vector { get; init; } = new JsonObject();

    public string? Provider { get; init; }

    public string? TargetApi { get; init; }

    public IDictionary<string, object?> Doubles { get; init; } = new Dictionary<string, object?>();

    public string BaseDir { get; init; } = string.Empty;
}

public sealed class VectorException(string message, JsonNode? payload = null) : Exception(message)
{
    public JsonNode? Payload { get; } = payload;
}

public static class VectorAdapters
{
    public static IDictionary<string, VectorAdapter> Adapters() => new Dictionary<string, VectorAdapter>
    {
        ["DiscoveryConformance.enrich"] = new((input, ctx) =>
        {
            var provider = ctx.Provider ?? string.Empty;
            var baseInfo = ModelInfo.Load(ToObjectDictionary(input as JsonObject ?? new JsonObject()));
            return ToJsonNode(Discovery.Enrich(baseInfo, provider).Save());
        }),
        ["DiscoveryConformance.mapModel"] = new((input, ctx) =>
        {
            var provider = ctx.Provider ?? string.Empty;
            return ToJsonNode(Discovery.MapModel(input, provider).Save());
        }),
    };

    public static IDictionary<string, string> Waivers() => new Dictionary<string, string>
    {
        ["LoadConformance.load"] = "Not yet wired (deferred). The C# loader is synchronous and wireable; scheduled for a follow-up increment.",
        ["Renderer.render"] = "Not yet wired (deferred). The C# pipeline API is async (Task-returning), but C# can bridge to the synchronous conformance harness via GetAwaiter().GetResult(); scheduled for a follow-up increment. Not wired here to avoid reimplementing runtime logic in the adapter.",
        ["Parser.parse"] = "Not yet wired (deferred). The C# pipeline API is async (Task-returning), but C# can bridge to the synchronous conformance harness via GetAwaiter().GetResult(); scheduled for a follow-up increment. Not wired here to avoid reimplementing runtime logic in the adapter.",
        ["WireConformance.toRequest"] = "Not yet wired (deferred). The C# pipeline API is async (Task-returning), but C# can bridge to the synchronous conformance harness via GetAwaiter().GetResult(); scheduled for a follow-up increment. Not wired here to avoid reimplementing runtime logic in the adapter.",
        ["Processor.process"] = "Not yet wired (deferred). The C# pipeline API is async (Task-returning), but C# can bridge to the synchronous conformance harness via GetAwaiter().GetResult(); scheduled for a follow-up increment. Not wired here to avoid reimplementing runtime logic in the adapter.",
        ["TurnConformance.replay"] = "Not yet wired (deferred). The turn runner is async but bridgeable via GetAwaiter().GetResult(); scheduled for a follow-up increment.",
        ["TurnConformance.run"] = "The run vectors assert an agent-loop accounting/observability contract (iteration counting = LLM-call count, total_messages including the final assistant message, exact event schemas) not yet matched by the runtime's internal accounting. Same honest gap as the Python reference.",
        ["TurnConformance.runTurn"] = "Requires the not-yet-implemented snapshot/portability turn engine. Same gap as the Python reference.",
    };

    public static IDictionary<string, object?> Doubles() => new Dictionary<string, object?>();

    private static JsonNode? ToJsonNode(Dictionary<string, object?> data) =>
        JsonSerializer.SerializeToNode(data);

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
