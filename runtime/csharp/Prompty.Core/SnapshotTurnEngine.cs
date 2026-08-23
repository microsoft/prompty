// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json.Nodes;

namespace Prompty.Core;

/// <summary>A tool invocation requested by the model within a turn.</summary>
public sealed class SnapshotToolCall(string id, string name, JsonObject? arguments = null)
{
    /// <summary>The tool-call id.</summary>
    public string Id { get; } = id;

    /// <summary>The tool name.</summary>
    public string Name { get; } = name;

    /// <summary>The tool arguments.</summary>
    public JsonObject Arguments { get; } = arguments ?? [];
}

/// <summary>
/// A normalized single model turn. <see cref="Output"/> is set for a final answer;
/// <see cref="ToolCalls"/> for a tool round. <see cref="NextPortability"/> /
/// <see cref="DelegatedState"/> declare the provider-state portability transition
/// that applies to the <em>next</em> snapshot.
/// </summary>
public sealed class SnapshotModelTurn
{
    /// <summary>The final answer, when this turn commits.</summary>
    public JsonNode? Output { get; init; }

    /// <summary>The tool calls requested by this turn.</summary>
    public IReadOnlyList<SnapshotToolCall> ToolCalls { get; init; } = [];

    /// <summary>The portability transition declared by this turn.</summary>
    public string? NextPortability { get; init; }

    /// <summary>The delegated provider state carried by the transition.</summary>
    public JsonArray? DelegatedState { get; init; }
}

/// <summary>The outcome of one tool invocation within a turn.</summary>
public sealed class SnapshotToolResult(string id, JsonNode? result, bool success)
{
    /// <summary>The tool-call id.</summary>
    public string Id { get; } = id;

    /// <summary>The tool result payload.</summary>
    public JsonNode? Result { get; } = result;

    /// <summary>Whether the tool executed successfully (false when permission-denied).</summary>
    public bool Success { get; } = success;
}

/// <summary>The observable result of a single turn.</summary>
public sealed class SnapshotTurnResult
{
    /// <summary>The turn status (<c>success</c>, <c>cancelled</c>, or <c>error</c>).</summary>
    public string Status { get; set; } = "success";

    /// <summary>The final output, when committed.</summary>
    public JsonNode? Output { get; set; }

    /// <summary>Number of model invocations.</summary>
    public int Iterations { get; set; }

    /// <summary>Number of snapshots (one per model iteration on the success path).</summary>
    public int Snapshots { get; set; }

    /// <summary>Stable message-prefix length at each snapshot.</summary>
    public List<int> SnapshotStablePrefixes { get; } = [];

    /// <summary>Provider-state portability entering each snapshot.</summary>
    public List<string> SnapshotPortability { get; } = [];

    /// <summary>Portability carried at commit time.</summary>
    public string CommitPortability { get; set; } = SnapshotTurnEngine.PortabilityPortable;

    /// <summary>Count of delegated provider-state entries at commit.</summary>
    public int DelegatedStateCount { get; set; }

    /// <summary>Every tool round's result (denied tools still produce a result).</summary>
    public List<SnapshotToolResult> ToolResults { get; } = [];

    /// <summary>Ordered tool-call ids of every tool round.</summary>
    public List<string> ToolResultOrder { get; } = [];

    /// <summary>The exact lifecycle event order.</summary>
    public List<string> Events { get; } = [];
}

/// <summary>
/// Provider-agnostic single-turn engine — the <c>TurnConformance.runTurn</c> engine.
///
/// Owns the <em>snapshot and portability</em> turn contract asserted by
/// <c>schema/model/conformance/vectors/turn.tsp</c> (stage <c>turn</c>). Like
/// <see cref="AgentLoopEngine"/>, it is provider-agnostic: the turn is driven by an
/// abstract <c>invokeModel</c> callback plus optional <c>resolvePermission</c> /
/// <c>executeTool</c> callbacks, so every provider shares one engine and supplies
/// only wire translation. It models the <em>durable</em> turn: per-iteration
/// snapshots, a stable-prefix marker, portability transitions (<c>portable</c> vs
/// <c>delegated</c> provider state), and a fixed lifecycle event vocabulary.
/// </summary>
public static class SnapshotTurnEngine
{
    /// <summary>Default maximum number of model iterations.</summary>
    public const int DefaultMaxIterations = 10;

    /// <summary>Portable provider-state marker.</summary>
    public const string PortabilityPortable = "portable";

    /// <summary>Delegated provider-state marker.</summary>
    public const string PortabilityDelegated = "delegated";

    /// <summary>
    /// Run one turn and return its snapshot/portability observable result. The turn
    /// is deterministic: given the same callbacks and inputs it always produces the
    /// same snapshots, portability transitions, tool ordering, and lifecycle events.
    /// </summary>
    /// <param name="messages">The starting conversation.</param>
    /// <param name="invokeModel">One model turn, given the iteration and pending tool results.</param>
    /// <param name="resolvePermission">Whether a tool call is approved (default: all).</param>
    /// <param name="executeTool">Executes an approved tool call (default: null output).</param>
    /// <param name="cancelBeforeRun">Cancel the turn before the first model call.</param>
    /// <param name="maxIterations">Maximum model iterations.</param>
    public static SnapshotTurnResult Run(
        IReadOnlyList<JsonObject> messages,
        Func<int, IReadOnlyList<SnapshotToolResult>, SnapshotModelTurn> invokeModel,
        Func<SnapshotToolCall, bool>? resolvePermission = null,
        Func<SnapshotToolCall, JsonNode?>? executeTool = null,
        bool cancelBeforeRun = false,
        int maxIterations = DefaultMaxIterations)
    {
        var result = new SnapshotTurnResult { Status = "success" };

        void Emit(string kind) => result.Events.Add(kind);

        Emit("turn_started");

        if (cancelBeforeRun)
        {
            Emit("turn_cancelled");
            result.Status = "cancelled";
            result.Output = null;
            return result;
        }

        var stablePrefix = messages.Count;
        var pendingPortability = PortabilityPortable;
        JsonArray delegatedState = [];
        var pendingToolResults = new List<SnapshotToolResult>();
        var approve = resolvePermission ?? (_ => true);
        var dispatch = executeTool ?? (_ => null);

        for (var iteration = 0; iteration < maxIterations; iteration++)
        {
            result.Iterations = iteration + 1;

            Emit("context_prepared");
            Emit("model_invocation_started");
            var turn = invokeModel(iteration, pendingToolResults);
            Emit("model_invocation_completed");

            // Snapshot: one per model iteration, using the portability entering this iteration.
            result.SnapshotPortability.Add(pendingPortability);
            result.SnapshotStablePrefixes.Add(stablePrefix);
            result.Snapshots += 1;
            Emit("checkpoint_created");

            // Apply the portability transition declared by this response.
            if (turn.NextPortability == PortabilityDelegated)
            {
                pendingPortability = PortabilityDelegated;
                delegatedState = turn.DelegatedState ?? [];
            }

            if (turn.ToolCalls.Count == 0)
            {
                result.Output = turn.Output;
                result.CommitPortability = pendingPortability;
                result.DelegatedStateCount = delegatedState.Count;
                Emit("turn_committed");
                Emit("post_commit_started");
                Emit("post_commit_completed");
                return result;
            }

            pendingToolResults = [];
            foreach (var call in turn.ToolCalls)
            {
                Emit("permission_requested");
                var approved = approve(call);
                Emit("permission_resolved");
                SnapshotToolResult toolResult;
                if (approved)
                {
                    Emit("tool_execution_started");
                    var output = dispatch(call);
                    Emit("tool_execution_completed");
                    toolResult = new SnapshotToolResult(call.Id, output, success: true);
                }
                else
                {
                    toolResult = new SnapshotToolResult(
                        call.Id,
                        new JsonObject { ["message"] = "Permission denied", ["error_kind"] = "permission_denied" },
                        success: false);
                }
                Emit("checkpoint_created");
                result.ToolResults.Add(toolResult);
                result.ToolResultOrder.Add(call.Id);
                pendingToolResults.Add(toolResult);
            }

            foreach (var _ in turn.ToolCalls)
                Emit("tool_result_committed");
            Emit("conversation_updated");
            Emit("checkpoint_created");
        }

        // Exhausted max iterations while still requesting tools.
        result.Status = "error";
        result.CommitPortability = pendingPortability;
        result.DelegatedStateCount = delegatedState.Count;
        return result;
    }
}
