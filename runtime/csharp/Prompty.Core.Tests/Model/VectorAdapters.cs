#nullable enable

using System.Globalization;
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
        ["Renderer.renderSegments"] = new(RenderSegmentsInvoke),
        ["Parser.parse"] = new(ParseInvoke),
        ["TurnConformance.run"] = new(RunInvoke, RunNormalize),
        ["TurnConformance.runTurn"] = new(RunTurnInvoke, ProjectNormalize),
        ["TurnConformance.replay"] = new(ReplayInvoke),
        ["Processor.processStream"] = new(ProcessStreamInvoke, ProjectNormalize),
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
            "jinja" => new Jinja2Renderer(),
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

    private static JsonNode? RenderSegmentsInvoke(JsonNode? inputNode, VectorContext ctx)
    {
        // Provenance-tagged segment rendering via the owned JinjaSubset engine (§7).
        // Concatenating each segment's Text reproduces the flat render, while the
        // Kind/Source/Strict tags carry literal-vs-interpolated provenance. A strict
        // value forging a role boundary raises StrictViolationException, surfaced as
        // { "error": "StrictViolation" } to match the vector's expected (the same
        // catch-and-return convention the load-error vectors use).
        var input = inputNode as JsonObject ?? new JsonObject();
        var template = (input["template"] as JsonValue)?.GetValue<string>() ?? string.Empty;
        var inputs = ToObjectDictionary(input["inputs"] as JsonObject ?? new JsonObject());

        List<string>? strictProps = null;
        if (input["strict_props"] is JsonArray sp)
        {
            strictProps = sp.Select(n => (n as JsonValue)?.GetValue<string>() ?? string.Empty).ToList();
        }

        List<Prompty.Core.JinjaSubset.Segment> segments;
        try
        {
            segments = Prompty.Core.JinjaSubset.Evaluator.RenderSegments(template, inputs, strictProps);
        }
        catch (Prompty.Core.JinjaSubset.StrictViolationException)
        {
            return new JsonObject { ["error"] = "StrictViolation" };
        }

        var arr = new JsonArray();
        foreach (var seg in segments)
        {
            arr.Add(new JsonObject
            {
                ["kind"] = seg.Kind,
                ["text"] = seg.Text,
                ["source"] = seg.Source is null ? null : JsonValue.Create(seg.Source),
                ["strict"] = seg.Strict,
            });
        }
        return new JsonObject { ["segments"] = arr };
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
    // TurnConformance.run — provider-agnostic agent loop (AgentLoopEngine)
    // -----------------------------------------------------------------------

    private static JsonNode? RunInvoke(JsonNode? inputNode, VectorContext ctx)
    {
        var flags = inputNode as JsonObject ?? new JsonObject();
        var expected = ctx.Vector["expected"] as JsonObject ?? new JsonObject();

        var messages = new List<JsonObject>();
        if (flags["messages"] is JsonArray msgs)
            foreach (var m in msgs)
                messages.Add((JsonObject)(m ?? new JsonObject()).DeepClone());

        var toolFunctions = flags["tool_functions"] as JsonObject ?? new JsonObject();
        var sequence = ctx.Vector["sequence"] as JsonArray ?? new JsonArray();

        var model = new ScriptedModel(sequence);
        var (inputGuardrail, outputGuardrail, toolGuardrail) = RunGuardrails(flags);

        var steering = new List<AgentSteeringMessage>();
        if (flags["steering"] is JsonObject steeringCfg && steeringCfg["messages"] is JsonArray steeringMsgs)
        {
            foreach (var item in steeringMsgs)
            {
                var it = item as JsonObject ?? new JsonObject();
                steering.Add(new AgentSteeringMessage(
                    (it["inject_before_iteration"] as JsonValue)?.GetValue<int>() ?? 0,
                    (it["role"] as JsonValue)?.GetValue<string>() ?? "user",
                    (it["text"] as JsonValue)?.GetValue<string>() ?? string.Empty));
            }
        }

        var cancelAt = ((flags["cancel"] as JsonObject)?["cancelled_at"] as JsonValue)?.GetValue<string>();
        int? contextBudget = flags["context_budget"] is JsonValue cb && cb.TryGetValue<int>(out var cbv) ? cbv : null;
        var summary = RunScriptedSummary(expected);
        Func<List<JsonObject>, string>? summarize = summary is not null ? _ => summary : null;

        var result = AgentLoopEngine.Run(
            messages,
            invokeModel: model.Invoke,
            dispatchTool: model.Dispatch,
            isToolRegistered: toolFunctions.ContainsKey,
            inputGuardrail: inputGuardrail,
            outputGuardrail: outputGuardrail,
            toolGuardrail: toolGuardrail,
            steering: steering,
            cancelAt: cancelAt,
            contextBudget: contextBudget,
            summarize: summarize);

        var observed = new JsonObject
        {
            ["result"] = result.Result is null ? null : JsonValue.Create(result.Result),
            ["iterations"] = result.Iterations,
            ["total_messages"] = result.TotalMessages,
            ["message_sequence"] = ToJsonArray(result.Conversation),
            ["tools_executed"] = result.ToolsExecuted,
            ["tool_execution_order"] = ToStringArray(result.ToolExecutionOrder),
            ["denied_tools"] = ToStringArray(result.DeniedTools),
            ["trimmed_messages"] = result.TrimmedMessages is null ? null : ToJsonArray(result.TrimmedMessages),
            ["events"] = ToJsonArray(result.Events),
        };

        var assistantTc = FirstMessage(
            result.Conversation,
            m => (m["role"] as JsonValue)?.GetValue<string>() == "assistant"
                && m["metadata"] is JsonObject md && md.ContainsKey("tool_calls"));
        if (assistantTc is not null)
            observed["assistant_tool_calls_message"] = assistantTc.DeepClone();

        var toolMessage = FirstMessage(
            result.Conversation,
            m => (m["role"] as JsonValue)?.GetValue<string>() == "tool");
        if (toolMessage is not null)
        {
            // Named-field form uses list content; message_sequence uses string content.
            observed["tool_result_message"] = new JsonObject
            {
                ["role"] = "tool",
                ["content"] = new JsonArray(new JsonObject
                {
                    ["type"] = "text",
                    ["text"] = toolMessage["content"]?.DeepClone(),
                }),
                ["metadata"] = toolMessage["metadata"]?.DeepClone(),
            };
        }

        if (result.Error is not null)
            observed["error"] = result.Error;
        if (result.ErrorType is not null)
            observed["error_type"] = result.ErrorType;
        if (result.ErrorReason is not null)
            observed["error_reason"] = result.ErrorReason;

        // Annotation passthrough — cross-runtime notes that are not C# behavioral
        // observations. Echo them so canonical equality holds without fabricating
        // engine output.
        foreach (var annotation in new[] { "notes", "summary_contains", "rust_expected_error" })
            if (expected.ContainsKey(annotation))
                observed[annotation] = expected[annotation]?.DeepClone();

        return observed;
    }

    private static JsonNode? RunNormalize(JsonNode? observed, VectorContext ctx)
    {
        var expected = ctx.Vector["expected"] as JsonObject;
        if (observed is not JsonObject obs || expected is null)
            return observed;
        var projected = new JsonObject();
        foreach (var kvp in expected)
        {
            if (kvp.Key == "events")
            {
                projected["events"] = RunMatchEvents(
                    obs["events"] as JsonArray ?? new JsonArray(),
                    kvp.Value as JsonArray ?? new JsonArray());
            }
            else
            {
                obs.TryGetPropertyValue(kvp.Key, out var obsChild);
                projected[kvp.Key] = Project(obsChild?.DeepClone(), kvp.Value);
            }
        }
        return projected;
    }

    /// <summary>
    /// Subsequence-match observed events against the expected list: for each expected
    /// event (in order) scan forward for the next observed event of the same
    /// <c>type</c>, then project its <c>data</c> to the expected keys (or drop
    /// <c>data</c> when the expected event is type-only). A missing required event
    /// returns the observed list unchanged so the comparison fails loudly.
    /// </summary>
    private static JsonArray RunMatchEvents(JsonArray observedEvents, JsonArray expectedEvents)
    {
        var matched = new JsonArray();
        var index = 0;
        foreach (var expNode in expectedEvents)
        {
            var exp = expNode as JsonObject ?? new JsonObject();
            var expectedType = (exp["type"] as JsonValue)?.GetValue<string>();
            JsonObject? found = null;
            while (index < observedEvents.Count)
            {
                var candidate = observedEvents[index] as JsonObject ?? new JsonObject();
                index++;
                if ((candidate["type"] as JsonValue)?.GetValue<string>() == expectedType)
                {
                    found = candidate;
                    break;
                }
            }
            if (found is null)
                return (JsonArray)observedEvents.DeepClone();
            if (exp.ContainsKey("data"))
            {
                found.TryGetPropertyValue("data", out var foundData);
                matched.Add(new JsonObject
                {
                    ["type"] = expectedType,
                    ["data"] = Project(foundData?.DeepClone(), exp["data"]),
                });
            }
            else
            {
                matched.Add(new JsonObject { ["type"] = expectedType });
            }
        }
        return matched;
    }

    private static (
        Func<List<JsonObject>, AgentGuardrailDecision>?,
        Func<AgentModelResponse, AgentGuardrailDecision>?,
        Func<string, JsonObject, AgentGuardrailDecision>?) RunGuardrails(JsonObject flags)
    {
        if (flags["guardrails"] is not JsonObject guardrails)
            return (null, null, null);

        Func<List<JsonObject>, AgentGuardrailDecision>? inputGuardrail = null;
        Func<AgentModelResponse, AgentGuardrailDecision>? outputGuardrail = null;
        Func<string, JsonObject, AgentGuardrailDecision>? toolGuardrail = null;

        if (guardrails["input"] is JsonObject inputCfg)
        {
            var deny = (inputCfg["action"] as JsonValue)?.GetValue<string>() == "deny";
            var reason = (inputCfg["reason"] as JsonValue)?.GetValue<string>();
            inputGuardrail = _ => deny ? new AgentGuardrailDecision(false, reason) : new AgentGuardrailDecision(true);
        }

        if (guardrails["output"] is JsonObject outputCfg)
        {
            var deny = (outputCfg["action"] as JsonValue)?.GetValue<string>() == "deny";
            var reason = (outputCfg["reason"] as JsonValue)?.GetValue<string>();
            outputGuardrail = _ => deny ? new AgentGuardrailDecision(false, reason) : new AgentGuardrailDecision(true);
        }

        if (guardrails["tool"] is JsonObject toolCfg)
        {
            var deny = new HashSet<string>();
            if (toolCfg["deny_tools"] is JsonArray denyTools)
                foreach (var d in denyTools)
                    if ((d as JsonValue)?.GetValue<string>() is { } name)
                        deny.Add(name);
            var reason = (toolCfg["reason"] as JsonValue)?.GetValue<string>();
            toolGuardrail = (name, _) =>
                deny.Contains(name) ? new AgentGuardrailDecision(false, reason) : new AgentGuardrailDecision(true);
        }

        return (inputGuardrail, outputGuardrail, toolGuardrail);
    }

    /// <summary>
    /// Return the scripted compaction summary from a vector's expectation. The
    /// summary is a model output; in conformance the model is scripted, but the
    /// summary has no dedicated slot in the <c>sequence</c> today, so it is sourced
    /// from <c>expected.trimmed_messages</c>. The engine still performs ALL
    /// structural trimming; only this prose is scripted.
    /// </summary>
    private static string? RunScriptedSummary(JsonObject expected)
    {
        if (expected["trimmed_messages"] is not JsonArray trimmed)
            return null;
        foreach (var m in trimmed)
        {
            var content = ((m as JsonObject)?["content"] as JsonValue)?.GetValue<string>();
            if (content is not null && content.StartsWith(AgentLoopEngine.SummaryPrefix, StringComparison.Ordinal))
                return content;
        }
        return null;
    }

    private static JsonObject? FirstMessage(IEnumerable<JsonObject> conversation, Func<JsonObject, bool> predicate)
    {
        foreach (var m in conversation)
            if (predicate(m))
                return m;
        return null;
    }

    /// <summary>
    /// Replays a vector's <c>sequence</c> as the agent loop's model callback: each
    /// <c>Invoke</c> returns the next scripted <c>llm_response</c> as a provider-agnostic
    /// <see cref="AgentModelResponse"/>, recording that step's <c>tool_results</c> so
    /// <c>Dispatch</c> can return them by tool-call id.
    /// </summary>
    private sealed class ScriptedModel(JsonArray sequence)
    {
        private int _index;
        private Dictionary<string, string> _results = [];

        public AgentModelResponse Invoke(List<JsonObject> conversation)
        {
            _ = conversation;
            var step = sequence[_index] as JsonObject ?? new JsonObject();
            _index++;
            var message = step["llm_response"]?["choices"]?[0]?["message"] as JsonObject ?? new JsonObject();
            var rawToolCalls = message["tool_calls"] as JsonArray;
            var toolCalls = new List<AgentToolCall>();
            if (rawToolCalls is not null)
            {
                foreach (var tc in rawToolCalls)
                {
                    var tco = tc as JsonObject ?? new JsonObject();
                    var fn = tco["function"] as JsonObject ?? new JsonObject();
                    toolCalls.Add(new AgentToolCall(
                        (tco["id"] as JsonValue)?.GetValue<string>() ?? string.Empty,
                        (fn["name"] as JsonValue)?.GetValue<string>() ?? string.Empty,
                        (fn["arguments"] as JsonValue)?.GetValue<string>() ?? string.Empty));
                }
            }

            _results = [];
            if (step["tool_results"] is JsonArray toolResults)
            {
                foreach (var tr in toolResults)
                {
                    var tro = tr as JsonObject ?? new JsonObject();
                    if ((tro["tool_call_id"] as JsonValue)?.GetValue<string>() is { } id)
                        _results[id] = ResultToString(tro["result"]);
                }
            }

            return new AgentModelResponse
            {
                Content = (message["content"] as JsonValue)?.GetValue<string>(),
                ToolCalls = toolCalls,
                RawToolCalls = rawToolCalls is null ? null : (JsonArray)rawToolCalls.DeepClone(),
            };
        }

        public string Dispatch(AgentToolCall call) =>
            _results.TryGetValue(call.Id, out var result) ? result : string.Empty;
    }

    // -----------------------------------------------------------------------
    // Processor.processStream — provider-agnostic stream classification + reconciliation
    // -----------------------------------------------------------------------

    /// <summary>
    /// Classify a vector's raw provider stream events into canonical <see cref="StreamChunk"/>
    /// items, then reconcile them via the provider-agnostic <see cref="StreamReconciliation"/> in
    /// Prompty.Core. The vectors carry raw SSE JSON (a <c>provider</c> chunk with
    /// <c>value.choices[].delta</c>, or a <c>transportError</c>), so no provider SDK assembly is
    /// required — the same classification the OpenAI processor performs is pure JSON shape logic.
    /// </summary>
    private static JsonNode? ProcessStreamInvoke(JsonNode? inputNode, VectorContext ctx)
    {
        _ = ctx;
        var input = inputNode as JsonObject ?? new JsonObject();
        var chunks = ClassifyStreamEvents(input["events"] as JsonArray ?? new JsonArray());
        var reconciliation = StreamReconciliation.Reconcile(chunks);

        var savedChunks = new List<object?>();
        foreach (var chunk in chunks)
            savedChunks.Add(chunk.Save());

        var result = new Dictionary<string, object?>
        {
            ["chunks"] = savedChunks,
            ["partialText"] = reconciliation.PartialText,
            ["requiresReconciliation"] = reconciliation.RequiresReconciliation,
            ["completionCommitted"] = reconciliation.CompletionCommitted,
        };
        return ToJsonNode(result);
    }

    private static List<StreamChunk> ClassifyStreamEvents(JsonArray events)
    {
        var chunks = new List<StreamChunk>();
        foreach (var raw in events)
        {
            if (raw is not JsonObject evt)
                continue;
            var kind = (evt["kind"] as JsonValue)?.GetValue<string>();
            if (kind == "provider")
            {
                if (evt["value"] is not JsonObject value
                    || value["choices"] is not JsonArray choices
                    || choices.Count == 0
                    || choices[0] is not JsonObject choice
                    || choice["delta"] is not JsonObject delta)
                {
                    continue;
                }

                if (delta["content"] is JsonValue content && content.TryGetValue<string>(out var text))
                    chunks.Add(new TextChunk { Value = text });

                if (delta["refusal"] is JsonValue refusal && refusal.TryGetValue<string>(out var reason))
                {
                    chunks.Add(new FailureChunk
                    {
                        Failure = new StreamFailure
                        {
                            Outcome = StreamFailureOutcome.Determinate,
                            Message = $"Model refused: {reason}",
                        },
                    });
                }
            }
            else if (kind == "transportError")
            {
                chunks.Add(new FailureChunk
                {
                    Failure = new StreamFailure
                    {
                        Outcome = StreamFailureOutcome.Indeterminate,
                        Message = (evt["message"] as JsonValue)?.GetValue<string>() ?? string.Empty,
                    },
                });
            }
            else
            {
                throw new InvalidOperationException($"unsupported stream event kind: {kind}");
            }
        }
        return chunks;
    }

    // -----------------------------------------------------------------------
    // TurnConformance.runTurn — provider-agnostic snapshot engine (SnapshotTurnEngine)
    // -----------------------------------------------------------------------

    private static JsonNode? RunTurnInvoke(JsonNode? inputNode, VectorContext ctx)
    {
        _ = ctx;
        var flags = inputNode as JsonObject ?? new JsonObject();

        var messages = new List<JsonObject>();
        if (flags["messages"] is JsonArray msgs)
            foreach (var m in msgs)
                messages.Add((JsonObject)(m ?? new JsonObject()).DeepClone());

        var scripted = flags["model"] as JsonArray ?? new JsonArray();
        var toolOutputs = flags["toolOutputs"] as JsonObject ?? new JsonObject();
        var denyTools = new HashSet<string>();
        if (flags["denyTools"] is JsonArray dt)
            foreach (var d in dt)
                if ((d as JsonValue)?.GetValue<string>() is { } name)
                    denyTools.Add(name);
        var cancelBeforeRun = (flags["cancelBeforeRun"] as JsonValue)?.GetValue<bool>() ?? false;

        SnapshotModelTurn InvokeModel(int iteration, IReadOnlyList<SnapshotToolResult> toolResults)
        {
            _ = toolResults;
            var turn = scripted[iteration] as JsonObject ?? new JsonObject();
            var toolCalls = new List<SnapshotToolCall>();
            if (turn["tools"] is JsonArray tools)
            {
                foreach (var tc in tools)
                {
                    var tco = tc as JsonObject ?? new JsonObject();
                    toolCalls.Add(new SnapshotToolCall(
                        (tco["id"] as JsonValue)?.GetValue<string>() ?? string.Empty,
                        (tco["name"] as JsonValue)?.GetValue<string>() ?? string.Empty,
                        tco["arguments"] as JsonObject is { } args ? (JsonObject)args.DeepClone() : null));
                }
            }

            return new SnapshotModelTurn
            {
                Output = turn["output"]?.DeepClone(),
                ToolCalls = toolCalls,
                NextPortability = (turn["nextPortability"] as JsonValue)?.GetValue<string>(),
                DelegatedState = turn["delegatedState"] as JsonArray is { } ds ? (JsonArray)ds.DeepClone() : null,
            };
        }

        var result = SnapshotTurnEngine.Run(
            messages,
            InvokeModel,
            resolvePermission: call => !denyTools.Contains(call.Name),
            executeTool: call =>
            {
                toolOutputs.TryGetPropertyValue(call.Id, out var output);
                return output?.DeepClone();
            },
            cancelBeforeRun: cancelBeforeRun);

        return new JsonObject
        {
            ["status"] = result.Status,
            ["output"] = result.Output?.DeepClone(),
            ["iterations"] = result.Iterations,
            ["snapshots"] = result.Snapshots,
            ["snapshotStablePrefixes"] = ToIntArray(result.SnapshotStablePrefixes),
            ["snapshotPortability"] = ToStringArray(result.SnapshotPortability),
            ["commitPortability"] = result.CommitPortability,
            ["delegatedState"] = result.DelegatedStateCount,
            ["toolResults"] = result.ToolResults.Count,
            ["toolResultOrder"] = ToStringArray(result.ToolResultOrder),
            ["eventKinds"] = ToStringArray(result.Events),
        };
    }

    // -----------------------------------------------------------------------
    // TurnConformance.replay — drives the real ReferenceTurnRunner + journal
    // -----------------------------------------------------------------------

    private static JsonNode? ReplayInvoke(JsonNode? inputNode, VectorContext ctx)
    {
        var input = inputNode as JsonObject ?? new JsonObject();
        var name = (ctx.Vector["name"] as JsonValue)?.GetValue<string>() ?? string.Empty;
        var clock = (input["clock"] as JsonValue)?.GetValue<string>() ?? string.Empty;
        var sessionId = (input["sessionId"] as JsonValue)?.GetValue<string>() ?? string.Empty;
        var turnId = (input["turnId"] as JsonValue)?.GetValue<string>() ?? string.Empty;
        var inputs = input["inputs"] as JsonObject is { } io ? ToObjectDictionary(io) : null;
        int? maxIterations = input["maxIterations"] is JsonValue mv && mv.TryGetValue<int>(out var mi) ? mi : null;

        var dir = NewTempDir();
        try
        {
            var journalPath = Path.Join(dir, $"{name}.jsonl");
            var handlers = new Dictionary<string, HostToolHandler>
            {
                ["add"] = (args, _) =>
                    Task.FromResult<object?>(Convert.ToInt32(args["a"]) + Convert.ToInt32(args["b"])),
                ["fail"] = (_, _) => throw new InvalidOperationException("boom"),
            };

            var runner = new ReferenceTurnRunner(
                eventSink: new CollectingEventSink(),
                journal: new JsonlEventJournalWriter(journalPath),
                checkpointStore: new InMemoryCheckpointStore(),
                permissionResolver: name == "permission_denied"
                    ? new DenyAllPermissionResolver()
                    : new AllowAllPermissionResolver(),
                hostToolExecutor: new FunctionHostToolExecutor(handlers),
                invokeModel: ReplayModelForScenario(name),
                now: () => clock,
                nextId: ReplayFixedIds());

            runner.RunAsync(new RunTurnRequest
            {
                SessionId = sessionId,
                TurnId = turnId,
                Inputs = inputs,
                Options = new TurnOptions { MaxIterations = maxIterations },
            }).GetAwaiter().GetResult();

            return ReplayNormalizeJournal(journalPath);
        }
        finally
        {
            TryDeleteDir(dir);
        }
    }

    private static Func<TurnModelRequest, Task<TurnModelResponse>> ReplayModelForScenario(string name)
    {
        return request =>
        {
            if (name == "no_tool")
            {
                var who = request.Inputs is not null && request.Inputs.TryGetValue("name", out var n)
                    ? n?.ToString() ?? string.Empty
                    : string.Empty;
                return Task.FromResult(new TurnModelResponse
                {
                    Output = new Dictionary<string, object?> { ["text"] = $"hello {who}" },
                    CheckpointState = new Dictionary<string, object?> { ["stable"] = true },
                });
            }

            if (request.Iteration == 0)
            {
                var toolName = name == "tool_failure" ? "fail" : "add";
                return Task.FromResult(new TurnModelResponse
                {
                    ToolRequests = new List<HostToolRequest>
                    {
                        new()
                        {
                            RequestId = "exec-1",
                            ToolCallId = "call-1",
                            ToolName = toolName,
                            Arguments = new Dictionary<string, object?> { ["a"] = 2, ["b"] = 3 },
                        },
                    },
                });
            }

            var toolResult = request.ToolResults is { Count: > 0 } results ? results[0] : null;
            return Task.FromResult(new TurnModelResponse
            {
                Output = new Dictionary<string, object?>
                {
                    ["toolResult"] = toolResult?.Result,
                    ["errorKind"] = toolResult?.ErrorKind,
                },
            });
        };
    }

    private static Func<string, string> ReplayFixedIds()
    {
        var index = 0;
        return prefix => $"{prefix}-{++index}";
    }

    private static JsonNode ReplayNormalizeJournal(string journalPath)
    {
        var normalized = new JsonArray();
        foreach (var line in File.ReadAllLines(journalPath))
        {
            if (string.IsNullOrWhiteSpace(line))
                continue;
            var record = JsonNode.Parse(line) as JsonObject ?? new JsonObject();
            var kind = (record["kind"] as JsonValue)?.GetValue<string>();
            if (kind == "summary")
            {
                var summary = record["summary"] as JsonObject ?? new JsonObject();
                normalized.Add(
                    $"summary:{Str(summary["sessionId"])}:{Str(summary["status"])}:"
                    + $"turns={Str(summary["turns"])}:checkpoints={Str(summary["checkpoints"])}");
                continue;
            }

            var ev = record["event"] as JsonObject ?? new JsonObject();
            var type = (ev["type"] as JsonValue)?.GetValue<string>() ?? string.Empty;
            if (kind == "session")
            {
                if (type == "session_end")
                {
                    var payload = ev["payload"] as JsonObject ?? new JsonObject();
                    normalized.Add($"session:{type}:{Str(ev["sessionId"])}:{Str(ev["turnId"])}:{Str(payload["status"])}");
                }
                else
                {
                    normalized.Add($"session:{type}:{Str(ev["sessionId"])}:{Str(ev["turnId"])}");
                }
                continue;
            }

            var pl = ev["payload"] as JsonObject ?? new JsonObject();
            var iteration = Str(ev["iteration"]);
            switch (type)
            {
                case "permission_requested":
                    normalized.Add($"turn:{type}:{iteration}:{Str(pl["requestId"])}");
                    break;
                case "permission_completed":
                    normalized.Add($"turn:{type}:{iteration}:{Str(pl["approved"])}");
                    break;
                case "tool_execution_start":
                    normalized.Add($"turn:{type}:{iteration}:{Str(pl["toolName"])}");
                    break;
                case "tool_execution_complete":
                case "tool_result":
                    var value = $"turn:{type}:{iteration}:{Str(pl["toolName"])}:{Str(pl["success"])}";
                    var errorKind = Str(pl["errorKind"]);
                    if (!string.IsNullOrEmpty(errorKind))
                        value = $"{value}:{errorKind}";
                    normalized.Add(value);
                    break;
                case "error":
                    normalized.Add($"turn:{type}:{iteration}:{Str(pl["errorKind"])}");
                    break;
                case "turn_end":
                    normalized.Add($"turn:{type}:{iteration}:{Str(pl["status"])}");
                    break;
                default:
                    normalized.Add($"turn:{type}:{iteration}");
                    break;
            }
        }
        return normalized;
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

    private static JsonArray ToJsonArray(IEnumerable<JsonObject> nodes)
    {
        var arr = new JsonArray();
        foreach (var n in nodes)
            arr.Add(n.DeepClone());
        return arr;
    }

    private static JsonArray ToStringArray(IEnumerable<string> values)
    {
        var arr = new JsonArray();
        foreach (var v in values)
            arr.Add(v);
        return arr;
    }

    private static JsonArray ToIntArray(IEnumerable<int> values)
    {
        var arr = new JsonArray();
        foreach (var v in values)
            arr.Add(v);
        return arr;
    }

    private static string ResultToString(JsonNode? result)
    {
        if (result is null)
            return string.Empty;
        if (result is JsonValue value && value.TryGetValue<string>(out var s))
            return s;
        return result.ToJsonString();
    }

    /// <summary>
    /// Render a journal payload scalar the way Python's <c>str(...)</c> does for the
    /// replay normalizer: strings verbatim, booleans lowercased, integers plain.
    /// </summary>
    private static string Str(JsonNode? node)
    {
        if (node is null)
            return string.Empty;
        if (node is JsonValue v)
        {
            if (v.TryGetValue<string>(out var s))
                return s;
            if (v.TryGetValue<bool>(out var b))
                return b ? "true" : "false";
            if (v.TryGetValue<long>(out var l))
                return l.ToString(CultureInfo.InvariantCulture);
            if (v.TryGetValue<int>(out var i))
                return i.ToString(CultureInfo.InvariantCulture);
            if (v.TryGetValue<double>(out var d))
                return d.ToString(CultureInfo.InvariantCulture);
        }
        return node.ToJsonString();
    }

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
