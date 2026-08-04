// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using Prompty.Core;

namespace Prompty.Core.Tests;

/// <summary>
/// Executes the shared canonical engine vectors in spec/vectors/engine/turn_vectors.json
/// against the C# <see cref="TurnEngine"/>. These vectors are the normative minimum: event
/// ordering, stable-prefix snapshot bookkeeping, sequential ordered tool execution, permission
/// denial being fed back to the model as a normal turn, delegated provider state, and
/// cancellation before context preparation must all match the Rust reference engine exactly.
/// </summary>
public class TurnEngineVectorTests
{
    private static readonly string SpecDir = FindSpecDir();

    [Fact]
    public async Task FinalOutput_MatchesVector() => await RunCaseAsync("final_output");

    [Fact]
    public async Task OrderedToolRound_MatchesVector() => await RunCaseAsync("ordered_tool_round");

    [Fact]
    public async Task PermissionDenialIsModelVisible_MatchesVector() => await RunCaseAsync("permission_denial_is_model_visible");

    [Fact]
    public async Task DelegatedProviderState_MatchesVector() => await RunCaseAsync("delegated_provider_state");

    [Fact]
    public async Task CancelBeforeContext_MatchesVector() => await RunCaseAsync("cancel_before_context");

    private static async Task RunCaseAsync(string name)
    {
        var testCase = LoadCases().First(c => c.GetProperty("name").GetString() == name);

        var messages = ParseMessages(testCase.GetProperty("messages"));
        var steps = ParseSteps(testCase.GetProperty("model"));
        var toolOutputs = testCase.TryGetProperty("toolOutputs", out var toolOutputsEl)
            ? toolOutputsEl.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetString() ?? string.Empty)
            : [];
        var denyTools = testCase.TryGetProperty("denyTools", out var denyToolsEl)
            ? denyToolsEl.EnumerateArray().Select(e => e.GetString()!).ToArray()
            : [];
        var cancelBeforeRun = testCase.TryGetProperty("cancelBeforeRun", out var cancelEl) && cancelEl.GetBoolean();

        var durability = new RecordingDurabilityPort();
        var postCommit = new RecordingPostCommitPort();
        var effects = new TurnEngineEffects
        {
            Model = new ScriptedModelPort(steps),
            Tools = new EchoToolPort(toolOutputs),
            Clock = new FakeEngineClock(),
            Ids = new FakeEngineIdGenerator(),
            Permission = new DenyByNamePermissionPort(denyTools),
            Durability = durability,
            PostCommit = postCommit,
        };

        var engine = new TurnEngine(effects);
        var request = new TurnEngineRequest("session-1", "turn-1", messages) { MaxIterations = 10 };

        using var cts = new CancellationTokenSource();
        if (cancelBeforeRun)
        {
            cts.Cancel();
        }

        var result = await engine.RunAsync(request, cts.Token);
        var expected = testCase.GetProperty("expected");

        Assert.Equal(ParseStatus(expected.GetProperty("status").GetString()!), result.Commit.Status);
        Assert.Equal(expected.GetProperty("iterations").GetInt32(), result.Commit.Iterations);
        Assert.Equal(expected.GetProperty("snapshots").GetInt32(), result.Snapshots?.Count ?? 0);
        Assert.Equal(expected.GetProperty("toolResults").GetInt32(), result.ToolResults?.Count ?? 0);

        if (expected.TryGetProperty("output", out var outputEl))
        {
            Assert.Equal(outputEl.GetString(), result.Commit.Output);
        }

        if (expected.TryGetProperty("snapshotStablePrefixes", out var prefixesEl))
        {
            var expectedPrefixes = prefixesEl.EnumerateArray().Select(e => e.GetInt32()).ToArray();
            var actualPrefixes = (result.Snapshots ?? []).Select(s => s.StablePrefixMessages).ToArray();
            Assert.Equal(expectedPrefixes, actualPrefixes);
        }

        if (expected.TryGetProperty("toolResultOrder", out var orderEl))
        {
            var expectedOrder = orderEl.EnumerateArray().Select(e => e.GetString()).ToArray();
            var actualOrder = (result.ToolResults ?? []).Select(t => t.RequestId).ToArray();
            Assert.Equal(expectedOrder, actualOrder);
        }

        if (expected.TryGetProperty("eventKinds", out var eventKindsEl))
        {
            var expectedKinds = eventKindsEl.EnumerateArray().Select(e => e.GetString()).ToArray();
            var actualKinds = durability.Events.Select(e => EngineEventKindParser.ToValue(e.Kind)).ToArray();
            Assert.Equal(expectedKinds, actualKinds);
        }

        if (expected.TryGetProperty("snapshotPortability", out var snapshotPortabilityEl))
        {
            var expectedPortability = snapshotPortabilityEl.EnumerateArray().Select(e => e.GetString()).ToArray();
            var actualPortability = (result.Snapshots ?? [])
                .Select(s => PortabilityToWire(s.ContextState.Portability))
                .ToArray();
            Assert.Equal(expectedPortability, actualPortability);
        }

        if (expected.TryGetProperty("commitPortability", out var commitPortabilityEl))
        {
            Assert.Equal(commitPortabilityEl.GetString(), PortabilityToWire(result.Commit.ContextState.Portability));
        }

        if (expected.TryGetProperty("delegatedState", out var delegatedStateEl))
        {
            Assert.Equal(delegatedStateEl.GetInt32(), result.Commit.ContextState.DelegatedState?.Count ?? 0);
        }

        // The final_output/ordered_tool_round/permission_denial/delegated_provider_state vectors
        // all commit successfully, so the non-fatal post-commit effect must always run exactly once.
        if (result.Commit.Status == EngineTurnStatus.Success)
        {
            Assert.Single(postCommit.Commits);
            Assert.Null(result.PostCommitError);
        }
    }

    private static EngineTurnStatus ParseStatus(string value) => value switch
    {
        "success" => EngineTurnStatus.Success,
        "failed" => EngineTurnStatus.Failed,
        "cancelled" => EngineTurnStatus.Cancelled,
        "reconciliation_required" => EngineTurnStatus.ReconciliationRequired,
        _ => throw new ArgumentOutOfRangeException(nameof(value), value, "unknown status"),
    };

    private static string PortabilityToWire(InvocationContextPortability portability) => portability switch
    {
        InvocationContextPortability.Portable => "portable",
        InvocationContextPortability.Delegated => "delegated",
        InvocationContextPortability.Opaque => "opaque",
        _ => throw new ArgumentOutOfRangeException(nameof(portability), portability, "unknown portability"),
    };

    private static InvocationContextPortability ParsePortability(string value) => value switch
    {
        "portable" => InvocationContextPortability.Portable,
        "delegated" => InvocationContextPortability.Delegated,
        "opaque" => InvocationContextPortability.Opaque,
        _ => throw new ArgumentOutOfRangeException(nameof(value), value, "unknown portability"),
    };

    private static List<Message> ParseMessages(JsonElement messagesEl) =>
        [.. messagesEl.EnumerateArray().Select(ParseMessage)];

    private static Message ParseMessage(JsonElement messageEl)
    {
        var role = messageEl.GetProperty("role").GetString();
        var content = messageEl.GetProperty("content").GetString() ?? string.Empty;
        return role switch
        {
            "assistant" => Message.Assistant(content),
            "system" => Message.System(content),
            _ => Message.User(content),
        };
    }

    private static List<ScriptedModelStep> ParseSteps(JsonElement modelEl) =>
        [.. modelEl.EnumerateArray().Select(ParseStep)];

    private static ScriptedModelStep ParseStep(JsonElement stepEl)
    {
        var tools = stepEl.TryGetProperty("tools", out var toolsEl)
            ? toolsEl.EnumerateArray().Select(ParseToolRequest).ToList()
            : [];

        var delegatedState = stepEl.TryGetProperty("delegatedState", out var delegatedEl)
            ? delegatedEl.EnumerateArray().Select(ParseDelegatedStateReference).ToList()
            : null;

        return new ScriptedModelStep
        {
            Assistant = stepEl.TryGetProperty("assistant", out var assistantEl) ? assistantEl.GetString() : null,
            Output = stepEl.TryGetProperty("output", out var outputEl) ? outputEl.GetString() : null,
            Tools = tools,
            NextPortability = stepEl.TryGetProperty("nextPortability", out var portabilityEl)
                ? ParsePortability(portabilityEl.GetString()!)
                : null,
            DelegatedState = delegatedState,
        };
    }

    private static ModelToolRequest ParseToolRequest(JsonElement toolEl) => new()
    {
        Id = toolEl.GetProperty("id").GetString()!,
        Name = toolEl.GetProperty("name").GetString()!,
        Arguments = toolEl.TryGetProperty("arguments", out var argsEl) ? JsonElementToObject(argsEl) : null,
    };

    private static DelegatedStateReference ParseDelegatedStateReference(JsonElement el) => new()
    {
        Provider = el.GetProperty("provider").GetString()!,
        Kind = el.GetProperty("kind").GetString()!,
        Id = el.GetProperty("id").GetString()!,
    };

    private static object? JsonElementToObject(JsonElement el) => el.ValueKind switch
    {
        JsonValueKind.String => el.GetString(),
        JsonValueKind.Number => el.TryGetInt64(out var l) ? l : el.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null => null,
        JsonValueKind.Array => el.EnumerateArray().Select(JsonElementToObject).ToList(),
        JsonValueKind.Object => el.EnumerateObject().ToDictionary(p => p.Name, p => JsonElementToObject(p.Value)),
        _ => null,
    };

    private static JsonElement[] LoadCases()
    {
        var path = Path.Combine(SpecDir, "vectors", "engine", "turn_vectors.json");
        var json = File.ReadAllText(path);
        using var doc = JsonDocument.Parse(json);
        return [.. doc.RootElement.GetProperty("cases").EnumerateArray().Select(e => e.Clone())];
    }

    private static string FindSpecDir()
    {
        var dir = AppContext.BaseDirectory;
        for (var i = 0; i < 10; i++)
        {
            var candidate = Path.Combine(dir, "spec");
            if (Directory.Exists(candidate))
            {
                return candidate;
            }

            dir = Path.GetDirectoryName(dir) ?? dir;
        }

        var projectRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
        return Path.Combine(projectRoot, "spec");
    }
}
