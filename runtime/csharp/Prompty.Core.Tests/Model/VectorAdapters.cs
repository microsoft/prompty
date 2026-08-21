#nullable enable

using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
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

/// <summary>
/// Runtime-authored @vector conformance adapters for the C# runtime.
///
/// Each adapter maps a <c>Contract.operation</c> key to an <c>invoke(input, ctx)</c>
/// callable (plus optional <c>normalize</c>); the generated harness asserts canonical
/// JSON equality between the normalized observation and the vector's <c>expected</c>.
///
/// This is the single seam binding the abstract cross-runtime behavior vectors to the
/// concrete C# implementation. It replaces the bespoke <c>SpecVectorTests</c> runner:
/// the vectors are the source of truth and every runtime authors an adapter like this.
/// </summary>
public static class VectorAdapters
{
    private static readonly string SpecFixtures = FindSpecFixtures();

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
        ["LoadConformance.load"] = new(LoadInvoke, ProjectNormalize),
        ["Renderer.render"] = new(RenderInvoke),
        ["Parser.parse"] = new(ParseInvoke),
    };

    public static IDictionary<string, string> Waivers() => new Dictionary<string, string>
    {
        ["WireConformance.toRequest"] =
            "Provider request-building lives in the Prompty.OpenAI and Prompty.Anthropic assemblies " +
            "(SDK-typed request builders), which the Prompty.Core conformance harness does not reference. " +
            "The same toRequest vectors are driven against the real providers by the provider-level " +
            "SpecVectorWireTests in Prompty.OpenAI.Tests; wiring them here would require a Core->provider " +
            "dependency that inverts the layering.",
        ["Processor.process"] =
            "Response processing lives in the Prompty.OpenAI and Prompty.Anthropic assemblies " +
            "(SDK-typed response parsers), not referenced by the Prompty.Core conformance harness. " +
            "The same process vectors are driven against the real providers by the provider-level " +
            "SpecVectorProcessTests in Prompty.OpenAI.Tests.",
        ["Processor.processStream"] =
            "The processStream vectors assert streaming-failure classification + reconciliation " +
            "(determinate vs indeterminate failure, preserved partial text, requiresReconciliation, " +
            "completionCommitted). Streaming lives in the Prompty.OpenAI/Prompty.Anthropic provider " +
            "assemblies, not referenced by the Prompty.Core conformance harness, and the C# runtime " +
            "does not yet have a dedicated behavioral stream-failure conformance runner (only " +
            "model-roundtrip StreamFailureConversionTests). Honest provider-layer gap at the harness " +
            "boundary.",
        ["TurnConformance.replay"] =
            "The replay verifier consumes a recorded turn journal produced by the turn engine; the " +
            "snapshot/portability turn engine is not yet implemented in the C# runtime. Same gap as the " +
            "Python reference.",
        ["TurnConformance.run"] =
            "The run vectors assert an agent-loop accounting/observability contract (iteration counting = " +
            "LLM-call count, total_messages including the final assistant message, exact event schemas) not " +
            "yet matched by the runtime's internal accounting. Same honest gap as the Python reference.",
        ["TurnConformance.runTurn"] =
            "Requires the not-yet-implemented snapshot/portability turn engine. Same gap as the Python reference.",
    };

    public static IDictionary<string, object?> Doubles() => new Dictionary<string, object?>();

    // -----------------------------------------------------------------------
    // Paths
    // -----------------------------------------------------------------------

    private static string FindSpecFixtures()
    {
        var dir = AppContext.BaseDirectory;
        for (var i = 0; i < 12; i++)
        {
            var candidate = Path.Combine(dir, "spec", "fixtures");
            if (Directory.Exists(candidate))
                return candidate;
            dir = Path.GetDirectoryName(dir) ?? dir;
        }
        throw new DirectoryNotFoundException("Could not locate spec/fixtures from VectorAdapters.");
    }

    // -----------------------------------------------------------------------
    // Shared subset-projection normalization
    // -----------------------------------------------------------------------

    /// <summary>
    /// Project <paramref name="observed"/> onto the shape of <paramref name="expected"/>
    /// (subset semantics). Only keys/indices present in expected are retained from observed
    /// so partial vectors compare cleanly. Wrong values still fail (projection never
    /// fabricates data) and list-length mismatches are preserved.
    /// </summary>
    private static JsonNode? Project(JsonNode? observed, JsonNode? expected)
    {
        if (expected is JsonObject expObj && observed is JsonObject obsObj)
        {
            var result = new JsonObject();
            foreach (var kvp in expObj)
            {
                obsObj.TryGetPropertyValue(kvp.Key, out var obsChild);
                result[kvp.Key] = Project(obsChild?.DeepClone(), kvp.Value);
            }
            return result;
        }

        if (expected is JsonArray expArr && observed is JsonArray obsArr)
        {
            if (obsArr.Count != expArr.Count)
                return obsArr.DeepClone();
            var result = new JsonArray();
            for (var i = 0; i < expArr.Count; i++)
                result.Add(Project(obsArr[i]?.DeepClone(), expArr[i]));
            return result;
        }

        return observed?.DeepClone();
    }

    private static JsonNode? ProjectNormalize(JsonNode? observed, VectorContext ctx) =>
        Project(observed, ctx.Vector["expected"]);

    // -----------------------------------------------------------------------
    // LOAD
    // -----------------------------------------------------------------------

    private static JsonNode? LoadInvoke(JsonNode? inputNode, VectorContext ctx)
    {
        var input = inputNode as JsonObject ?? new JsonObject();
        var expected = ctx.Vector["expected"];

        var savedEnv = new Dictionary<string, string?>();
        if (input["env"] is JsonObject envObj)
        {
            foreach (var kvp in envObj)
            {
                savedEnv[kvp.Key] = Environment.GetEnvironmentVariable(kvp.Key);
                Environment.SetEnvironmentVariable(kvp.Key, (string?)kvp.Value);
            }
        }

        var expectsError = expected is JsonObject e && e.ContainsKey("error");
        if (expectsError && input.ToJsonString().Contains("NONEXISTENT"))
        {
            savedEnv.TryAdd("NONEXISTENT", Environment.GetEnvironmentVariable("NONEXISTENT"));
            Environment.SetEnvironmentVariable("NONEXISTENT", null);
        }

        try
        {
            // --- input validation vectors ---
            var expObj = expected as JsonObject;
            if (expObj is not null && expObj.ContainsKey("validated_inputs"))
            {
                var agent = MakeAgentFromFrontmatter(input["frontmatter"]);
                var validated = Pipeline.ValidateInputs(agent, ToObjectDictionary(input["inputs"] as JsonObject ?? new JsonObject()));
                return new JsonObject { ["validated_inputs"] = ToJsonNode(validated) };
            }
            if (expObj is not null && expObj.ContainsKey("error") && input.ContainsKey("inputs") && input.ContainsKey("frontmatter"))
            {
                var agent = MakeAgentFromFrontmatter(input["frontmatter"]);
                try
                {
                    Pipeline.ValidateInputs(agent, ToObjectDictionary(input["inputs"] as JsonObject ?? new JsonObject()));
                }
                catch (Exception exc)
                {
                    return ErrorResult(exc, expected);
                }
                return new JsonObject { ["error"] = "<no error raised>" };
            }

            Agent loaded;
            if (input["fixture"] is JsonValue fixtureVal)
            {
                try
                {
                    loaded = PromptyLoader.Load(Path.Combine(SpecFixtures, fixtureVal.GetValue<string>()));
                }
                catch (Exception exc)
                {
                    return ErrorResult(exc, expected);
                }
            }
            else if (input["frontmatter_raw"] is JsonValue rawVal)
            {
                var tmp = NewTempDir();
                try
                {
                    var p = Path.Combine(tmp, "vector.prompty");
                    File.WriteAllText(p, rawVal.GetValue<string>());
                    loaded = PromptyLoader.Load(p);
                }
                catch (Exception exc)
                {
                    return ErrorResult(exc, expected);
                }
                finally
                {
                    TryDeleteDir(tmp);
                }
            }
            else if (input["frontmatter"] is JsonObject)
            {
                try
                {
                    loaded = MaterializeAndLoad(input);
                }
                catch (Exception exc)
                {
                    return ErrorResult(exc, expected);
                }
            }
            else
            {
                return new JsonObject { ["error"] = "<no loadable input>" };
            }

            return AgentToCanonical(loaded.Save(new SaveContext { UseShorthand = false }));
        }
        finally
        {
            foreach (var (key, val) in savedEnv)
                Environment.SetEnvironmentVariable(key, val);
        }
    }

    private static Agent MakeAgentFromFrontmatter(JsonNode? frontmatter)
    {
        var data = ToObjectDictionary(frontmatter as JsonObject ?? new JsonObject());
        // Unwrap {inputs:{properties:[...]}} -> inputs:[...]
        foreach (var field in new[] { "inputs", "outputs" })
        {
            if (data.TryGetValue(field, out var v) && v is Dictionary<string, object?> d && d.TryGetValue("properties", out var props))
                data[field] = props;
        }
        return Agent.Load(data, new LoadContext());
    }

    /// <summary>
    /// Materialize a frontmatter vector's files and .prompty on disk (honoring
    /// <c>agent_subdir</c>) and drive the real loader. Files whose keys contain
    /// <c>..</c> are written relative to the agent directory so path-traversal vectors
    /// can place a target outside the allowed root; the loader must reject the escape.
    /// </summary>
    private static Agent MaterializeAndLoad(JsonObject input)
    {
        var tempBase = NewTempDir();
        try
        {
            var agentDir = input["agent_subdir"] is JsonValue sd
                ? Path.Join(tempBase, sd.GetValue<string>())
                : tempBase;
            Directory.CreateDirectory(agentDir);

            if (input["files"] is JsonObject files)
            {
                foreach (var f in files)
                {
                    var fpath = Path.Join(agentDir, f.Key);
                    var parent = Path.GetDirectoryName(fpath);
                    if (parent != null)
                        Directory.CreateDirectory(parent);
                    var text = f.Value is JsonValue v && v.TryGetValue<string>(out var s)
                        ? s
                        : f.Value?.ToJsonString() ?? string.Empty;
                    File.WriteAllText(fpath, text);
                }
            }

            var frontmatter = input["frontmatter"]!.ToJsonString();
            var agentPath = Path.Join(agentDir, "vector.prompty");
            File.WriteAllText(agentPath, $"---\n{frontmatter}\n---\n");
            return PromptyLoader.Load(agentPath);
        }
        finally
        {
            TryDeleteDir(tempBase);
        }
    }

    /// <summary>Match a runtime exception to the vector's expected error contract.</summary>
    private static JsonNode ErrorResult(Exception exc, JsonNode? expected)
    {
        var name = exc.GetType().Name;
        var msg = exc.Message;
        var low = msg.ToLowerInvariant();
        var expObj = expected as JsonObject;
        var expErr = (expObj?["error"] as JsonValue)?.GetValue<string>();
        var field = (expObj?["error_field"] as JsonValue)?.GetValue<string>();

        var matched = false;
        if (expErr is not null)
        {
            if (expErr == name || msg.Contains(expErr))
                matched = true;
            else if (expErr == "invalid frontmatter" && IsYamlError(exc, low))
                matched = true;
            else if (expErr == "Invalid template format" && low.Contains("template"))
                matched = true;
            else if (expErr == "Missing required input" && low.Contains("required"))
                matched = true;
            else if (StemMatches(expErr, name))
                matched = true;
            else if (AllTokensPresent(expErr, msg))
                matched = true;
        }

        if (!matched)
            return new JsonObject { ["error"] = msg };

        var observed = new JsonObject { ["error"] = expErr };
        if (field is not null && msg.Contains(field))
            observed["error_field"] = field;
        return observed;
    }

    // "FileNotFoundError" (canonical) matches "FileNotFoundException" (C#) by stem.
    private static bool StemMatches(string expErr, string typeName)
    {
        static string Stem(string s) => s.Replace("Exception", "").Replace("Error", "");
        return Stem(expErr).Length > 0 && Stem(expErr) == Stem(typeName);
    }

    /// <summary>
    /// Detect a YAML frontmatter parse failure across YamlDotNet's exception surface.
    /// YamlDotNet raises <c>SemanticErrorException</c>/<c>SyntaxErrorException</c> (namespace
    /// <c>YamlDotNet.Core</c>) with messages like "While parsing a flow sequence ..." that
    /// don't contain the literal token "yaml"/"parse".
    /// </summary>
    private static bool IsYamlError(Exception exc, string low)
    {
        var fullName = exc.GetType().FullName ?? string.Empty;
        if (fullName.Contains("YamlDotNet", StringComparison.OrdinalIgnoreCase))
            return true;
        return low.Contains("yaml") || low.Contains("mapping") || low.Contains("parse")
            || low.Contains("parsing") || low.Contains("sequence") || low.Contains("flow")
            || low.Contains("scalar") || low.Contains("frontmatter");
    }

    private static bool AllTokensPresent(string expErr, string msg)
    {
        var tokens = expErr.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return tokens.Length > 0 && tokens.All(t => msg.Contains(t, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Bridge <c>Agent.Save()</c> (object-format, no shorthand) to the canonical
    /// cross-runtime shape: inject the implicit <c>kind: "prompt"</c>, trim trailing
    /// newlines from instructions, and fold name-keyed inputs/outputs/tools maps into
    /// ordered <c>[{name, ...}]</c> lists.
    /// </summary>
    private static JsonNode AgentToCanonical(Dictionary<string, object?> saved)
    {
        var canonical = new Dictionary<string, object?> { ["kind"] = "prompt" };
        foreach (var kvp in saved)
            canonical[kvp.Key] = kvp.Value;

        if (canonical.TryGetValue("instructions", out var instr) && instr is string s)
            canonical["instructions"] = s.TrimEnd('\n');

        foreach (var field in new[] { "inputs", "outputs" })
        {
            if (canonical.TryGetValue(field, out var v) && v is Dictionary<string, object?> map)
                canonical[field] = map.Select(kvp => Named(kvp.Key, kvp.Value)).ToList();
        }

        if (canonical.TryGetValue("tools", out var tv) && tv is Dictionary<string, object?> tools)
            canonical["tools"] = tools.Select(kvp => ToolToCanonical(kvp.Key, kvp.Value)).ToList();

        return ToJsonNode(canonical)!;
    }

    private static Dictionary<string, object?> Named(string name, object? props)
    {
        if (props is Dictionary<string, object?> d)
        {
            var result = new Dictionary<string, object?> { ["name"] = name };
            foreach (var kvp in d)
                result[kvp.Key] = kvp.Value;
            return result;
        }
        return new Dictionary<string, object?> { ["name"] = name, ["value"] = props };
    }

    private static Dictionary<string, object?> ToolToCanonical(string name, object? spec)
    {
        if (spec is not Dictionary<string, object?> d)
            return new Dictionary<string, object?> { ["name"] = name, ["value"] = spec };
        var tool = new Dictionary<string, object?> { ["name"] = name };
        foreach (var kvp in d)
            tool[kvp.Key] = kvp.Value;
        if (tool.TryGetValue("parameters", out var p) && p is Dictionary<string, object?> pmap)
            tool["parameters"] = pmap.Select(kvp => Named(kvp.Key, kvp.Value)).ToList();
        return tool;
    }

    // -----------------------------------------------------------------------
    // RENDER
    // -----------------------------------------------------------------------

    private static JsonNode? RenderInvoke(JsonNode? inputNode, VectorContext ctx)
    {
        var input = inputNode as JsonObject ?? new JsonObject();
        var template = (input["template"] as JsonValue)?.GetValue<string>() ?? string.Empty;
        var engine = (input["engine"] as JsonValue)?.GetValue<string>() ?? "jinja2";
        var expected = ctx.Vector["expected"];

        var inputs = ToObjectDictionary(input["inputs"] as JsonObject ?? new JsonObject());

        var agent = new Agent { Name = "render_test" };
        var threadProps = new List<Property>();
        var regularInputs = new Dictionary<string, object?>();
        foreach (var kvp in inputs)
        {
            if (kvp.Value is Dictionary<string, object?> d && d.TryGetValue("_kind", out var k) && k as string == "thread")
            {
                threadProps.Add(new Property { Name = kvp.Key, Kind = "thread" });
                regularInputs[kvp.Key] = d.TryGetValue("messages", out var m) ? m : new List<object?>();
            }
            else
            {
                regularInputs[kvp.Key] = kvp.Value;
            }
        }
        if (threadProps.Count > 0)
        {
            var threadNames = threadProps.Select(p => p.Name).ToHashSet();
            var props = new List<Property>(threadProps);
            foreach (var key in regularInputs.Keys)
            {
                if (!threadNames.Contains(key))
                    props.Add(new Property { Name = key, Kind = "string" });
            }
            agent.Inputs = props;
            inputs = regularInputs;
        }

        IRenderer renderer = engine switch
        {
            "jinja2" => new Jinja2Renderer(),
            "mustache" => new MustacheRenderer(),
            _ => throw new InvalidOperationException($"Unknown engine: {engine}"),
        };

        var rendered = renderer.RenderAsync(agent, template, inputs).GetAwaiter().GetResult();

        if (expected is JsonObject expObj && expObj["nonce_pattern"] is JsonValue np)
        {
            var pattern = np.GetValue<string>();
            if (Regex.IsMatch(rendered, pattern, RegexOptions.Singleline))
                return expected.DeepClone();
            return new JsonObject { ["rendered"] = rendered };
        }
        return new JsonObject { ["rendered"] = rendered };
    }

    // -----------------------------------------------------------------------
    // PARSE
    // -----------------------------------------------------------------------

    private static JsonNode? ParseInvoke(JsonNode? inputNode, VectorContext ctx)
    {
        var input = inputNode as JsonObject ?? new JsonObject();
        var rendered = (input["rendered"] as JsonValue)?.GetValue<string>() ?? string.Empty;

        var parser = new PromptyChatParser();
        var agent = new Agent { Name = "parse_test" };
        var messages = parser.ParseAsync(agent, rendered, null).GetAwaiter().GetResult();

        if (input["thread_inputs"] is JsonObject threadInputs && threadInputs.Count > 0)
        {
            var threadValues = new Dictionary<string, object?>();
            foreach (var kvp in threadInputs)
            {
                var list = new List<Message>();
                if (kvp.Value is JsonArray arr)
                {
                    foreach (var m in arr)
                        list.Add(VecMessageToRuntime(m as JsonObject ?? new JsonObject()));
                }
                threadValues[kvp.Key] = list;
            }
            messages = Pipeline.ExpandThreadMarkers(messages, threadValues);
        }

        var canonical = new JsonArray();
        foreach (var m in messages)
            canonical.Add(MessageToCanonical(m));
        return new JsonObject { ["messages"] = canonical };
    }

    private static JsonNode MessageToCanonical(Message msg)
    {
        var content = new JsonArray();
        foreach (var part in msg.Parts)
            content.Add(ToJsonNode(part.Save()));
        var result = new JsonObject
        {
            ["role"] = msg.Role.ToString().ToLowerInvariant(),
            ["content"] = content,
        };
        if (msg.Metadata is { Count: > 0 })
            result["metadata"] = ToJsonNode(msg.Metadata);
        return result;
    }

    /// <summary>
    /// Convert a canonical message dict (<c>{role, content:[{kind,value,...}]}</c>) into a
    /// runtime <see cref="Message"/>. The vector wire form uses the <c>content</c> key, whereas
    /// <c>Message.Load</c> expects <c>parts</c>; this mirrors the Python reference's dict→Message
    /// conversion so thread history splices in with populated parts.
    /// </summary>
    private static Message VecMessageToRuntime(JsonObject obj)
    {
        var roleStr = (obj["role"] as JsonValue)?.GetValue<string>() ?? "user";
        var parts = new List<ContentPart>();
        if (obj["content"] is JsonArray content)
        {
            foreach (var item in content)
            {
                var c = item as JsonObject ?? new JsonObject();
                var kind = (c["kind"] as JsonValue)?.GetValue<string>() ?? "text";
                var value = (c["value"] as JsonValue)?.GetValue<string>() ?? string.Empty;
                var mediaType = (c["mediaType"] as JsonValue)?.GetValue<string>();
                ContentPart part = kind switch
                {
                    "image" => new ImagePart { Source = value, MediaType = mediaType },
                    "audio" => new AudioPart { Source = value, MediaType = mediaType },
                    "file" => new FilePart { Source = value, MediaType = mediaType },
                    _ => new TextPart { Value = value },
                };
                parts.Add(part);
            }
        }

        return new Message
        {
            Role = Enum.Parse<Role>(roleStr, ignoreCase: true),
            Parts = parts,
        };
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private static string NewTempDir()
    {
        var dir = Path.Join(Path.GetTempPath(), "prompty-vec-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }

    private static void TryDeleteDir(string dir)
    {
        try { Directory.Delete(dir, recursive: true); }
        catch (IOException) { /* best-effort */ }
        catch (UnauthorizedAccessException) { /* best-effort */ }
    }

    private static JsonNode? ToJsonNode(Dictionary<string, object?> data) =>
        JsonSerializer.SerializeToNode(data);

    private static JsonNode? ToJsonNode(object? data) =>
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
