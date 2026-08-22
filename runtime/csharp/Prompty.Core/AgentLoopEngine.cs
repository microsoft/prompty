// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using System.Text.Json.Nodes;

namespace Prompty.Core;

/// <summary>
/// A single tool invocation requested by the model.
/// </summary>
public sealed class AgentToolCall(string id, string name, string arguments)
{
    /// <summary>The provider-assigned tool-call id.</summary>
    public string Id { get; } = id;

    /// <summary>The tool name.</summary>
    public string Name { get; } = name;

    /// <summary>The raw JSON argument string exactly as the model emitted it.</summary>
    public string Arguments { get; } = arguments;
}

/// <summary>
/// A normalized single-turn model response. <see cref="RawToolCalls"/> carries the
/// provider's exact tool-call array so the assistant message's
/// <c>metadata.tool_calls</c> round-trips byte-for-byte; when null the engine
/// reconstructs it from <see cref="ToolCalls"/>.
/// </summary>
public sealed class AgentModelResponse
{
    /// <summary>The assistant content (final answer) when there are no tool calls.</summary>
    public string? Content { get; init; }

    /// <summary>The tool calls requested by the model, if any.</summary>
    public IReadOnlyList<AgentToolCall> ToolCalls { get; init; } = [];

    /// <summary>The provider's exact raw tool-call array, preserved verbatim.</summary>
    public JsonArray? RawToolCalls { get; init; }
}

/// <summary>Outcome of a guardrail check.</summary>
public sealed class AgentGuardrailDecision(bool allowed, string? reason = null)
{
    /// <summary>Whether the guarded action is permitted.</summary>
    public bool Allowed { get; } = allowed;

    /// <summary>The denial reason, when not allowed.</summary>
    public string? Reason { get; } = reason;
}

/// <summary>A steering message scheduled for injection before a given iteration.</summary>
public sealed class AgentSteeringMessage(int injectBeforeIteration, string role, string text)
{
    /// <summary>The 1-based iteration this message is injected before.</summary>
    public int InjectBeforeIteration { get; } = injectBeforeIteration;

    /// <summary>The message role.</summary>
    public string Role { get; } = role;

    /// <summary>The message text.</summary>
    public string Text { get; } = text;
}

/// <summary>The observable result of an agent-loop run.</summary>
public sealed class AgentLoopResult
{
    /// <summary>The final assistant answer, when the loop completed normally.</summary>
    public string? Result { get; set; }

    /// <summary>Number of LLM calls (not tool rounds).</summary>
    public int Iterations { get; set; }

    /// <summary>The accumulated conversation.</summary>
    public List<JsonObject> Conversation { get; set; } = [];

    /// <summary>The ordered event stream (<c>{type, data}</c>).</summary>
    public List<JsonObject> Events { get; } = [];

    /// <summary>Number of tool rounds executed.</summary>
    public int ToolRounds { get; set; }

    /// <summary>Number of individual tools executed.</summary>
    public int ToolsExecuted { get; set; }

    /// <summary>Ordered names of executed tools.</summary>
    public List<string> ToolExecutionOrder { get; } = [];

    /// <summary>Names of tools denied by a guardrail.</summary>
    public List<string> DeniedTools { get; } = [];

    /// <summary>The compacted conversation, when trimming occurred.</summary>
    public List<JsonObject>? TrimmedMessages { get; set; }

    /// <summary>The error marker (class name), when the loop failed.</summary>
    public string? Error { get; set; }

    /// <summary>The error type, for tool-registration errors.</summary>
    public string? ErrorType { get; set; }

    /// <summary>The guardrail denial reason, when applicable.</summary>
    public string? ErrorReason { get; set; }

    /// <summary>Conversation length plus the conformance <c>+1</c> when tools ran.</summary>
    public int TotalMessages => Conversation.Count + (ToolRounds > 0 ? 1 : 0);
}

/// <summary>
/// Provider-agnostic agent loop — the canonical <c>TurnConformance.run</c> engine.
///
/// Owns the observable agent-loop contract asserted by the cross-runtime
/// <c>@vector</c> suite (<c>schema/model/conformance/vectors/agent.tsp</c>, stage
/// <c>agent</c>). The loop is driven by two abstract callbacks —
/// <c>invokeModel(conversation)</c> and <c>dispatchTool(call)</c> — so the same
/// engine backs every provider; providers supply only wire translation. Errors are
/// returned as fields on <see cref="AgentLoopResult"/> (not thrown) so the
/// accumulated conversation and events remain observable on the failure path.
/// </summary>
public static class AgentLoopEngine
{
    /// <summary>Default maximum number of LLM iterations.</summary>
    public const int DefaultMaxIterations = 10;

    /// <summary>Canonical compaction-summary prefix.</summary>
    public const string SummaryPrefix = "[Summary of earlier conversation] ";

    // Canonical error markers mirroring the exception class names the vectors assert.
    private const string CancelledError = "CancelledError";
    private const string GuardrailErrorMarker = "GuardrailError";

    /// <summary>
    /// Run the canonical agent loop and return its observable result.
    /// </summary>
    /// <param name="messages">The starting conversation.</param>
    /// <param name="invokeModel">One LLM call, returning a normalized response.</param>
    /// <param name="dispatchTool">One tool execution, returning its string result.</param>
    /// <param name="isToolRegistered">Whether a tool name is registered (default: all).</param>
    /// <param name="maxIterations">Maximum LLM iterations.</param>
    /// <param name="inputGuardrail">Runs before each LLM call.</param>
    /// <param name="outputGuardrail">Runs on each model response.</param>
    /// <param name="toolGuardrail">Runs before each tool execution.</param>
    /// <param name="steering">Steering messages to inject before specific iterations.</param>
    /// <param name="cancelAt">Scripted cancellation position.</param>
    /// <param name="contextBudget">Character budget triggering compaction.</param>
    /// <param name="summarize">Summarizer for compaction.</param>
    public static AgentLoopResult Run(
        IEnumerable<JsonObject> messages,
        Func<List<JsonObject>, AgentModelResponse> invokeModel,
        Func<AgentToolCall, string> dispatchTool,
        Func<string, bool>? isToolRegistered = null,
        int maxIterations = DefaultMaxIterations,
        Func<List<JsonObject>, AgentGuardrailDecision>? inputGuardrail = null,
        Func<AgentModelResponse, AgentGuardrailDecision>? outputGuardrail = null,
        Func<string, JsonObject, AgentGuardrailDecision>? toolGuardrail = null,
        IReadOnlyList<AgentSteeringMessage>? steering = null,
        string? cancelAt = null,
        int? contextBudget = null,
        Func<List<JsonObject>, string>? summarize = null)
    {
        var result = new AgentLoopResult();
        var conversation = messages.Select(m => (JsonObject)m.DeepClone()).ToList();

        void Emit(string eventType, JsonObject data) =>
            result.Events.Add(new JsonObject { ["type"] = eventType, ["data"] = data });

        Emit("status", new JsonObject { ["message"] = "Starting agent loop" });

        var trimmed = MaybeTrim(conversation, contextBudget, summarize);
        if (trimmed is not null)
        {
            conversation = trimmed;
            result.TrimmedMessages = trimmed.Select(m => (JsonObject)m.DeepClone()).ToList();
        }

        var steeringPending = new List<AgentSteeringMessage>(steering ?? []);
        var registered = isToolRegistered ?? (_ => true);

        while (true)
        {
            var iterationNumber = result.Iterations + 1;

            if (cancelAt == "before_iteration" && iterationNumber == 1)
            {
                Emit("cancelled", new JsonObject { ["reason"] = "Cancellation requested before first iteration" });
                result.Error = CancelledError;
                result.Conversation = conversation;
                return result;
            }

            if (cancelAt == $"before_iteration_{iterationNumber}")
            {
                Emit("cancelled", new JsonObject { ["reason"] = $"Cancellation requested before iteration {iterationNumber}" });
                result.Error = CancelledError;
                result.Conversation = conversation;
                return result;
            }

            var toInject = steeringPending.Where(s => s.InjectBeforeIteration == iterationNumber).ToList();
            if (toInject.Count > 0)
            {
                foreach (var s in toInject)
                    steeringPending.Remove(s);
                Emit("status", new JsonObject { ["message"] = "Injecting steering message" });
                foreach (var s in toInject)
                    conversation.Add(new JsonObject { ["role"] = s.Role, ["content"] = s.Text });
                Emit("messages_updated", new JsonObject { ["message_count"] = conversation.Count + 1 });
            }

            if (inputGuardrail is not null)
            {
                var decision = inputGuardrail(conversation);
                if (!decision.Allowed)
                {
                    result.Error = GuardrailErrorMarker;
                    result.ErrorReason = decision.Reason;
                    result.Conversation = conversation;
                    return result;
                }
            }

            var response = invokeModel(conversation);
            result.Iterations += 1;

            if (outputGuardrail is not null)
            {
                var decision = outputGuardrail(response);
                if (!decision.Allowed)
                {
                    result.Error = GuardrailErrorMarker;
                    result.ErrorReason = decision.Reason;
                    result.Conversation = conversation;
                    return result;
                }
            }

            if (response.ToolCalls.Count > 0)
            {
                conversation.Add(AssistantToolCallsMessage(response));
                result.ToolRounds += 1;
                var cancelled = false;

                for (var idx = 0; idx < response.ToolCalls.Count; idx++)
                {
                    var call = response.ToolCalls[idx];
                    Emit("tool_call_start", new JsonObject { ["name"] = call.Name, ["arguments"] = call.Arguments });

                    if (toolGuardrail is not null)
                    {
                        var decision = toolGuardrail(call.Name, ParseArgs(call.Arguments));
                        if (!decision.Allowed)
                        {
                            result.DeniedTools.Add(call.Name);
                            var denial = $"Tool denied by guardrail: {decision.Reason}";
                            conversation.Add(ToolMessage(call.Id, denial));
                            continue;
                        }
                    }

                    if (!registered(call.Name))
                    {
                        result.Error = $"Tool not registered: {call.Name}";
                        result.ErrorType = "ValueError";
                        result.Conversation = conversation;
                        return result;
                    }

                    var output = dispatchTool(call);
                    result.ToolsExecuted += 1;
                    result.ToolExecutionOrder.Add(call.Name);
                    Emit("tool_result", new JsonObject { ["name"] = call.Name, ["result"] = output });
                    conversation.Add(ToolMessage(call.Id, output));

                    if (cancelAt == $"after_tool_{idx}")
                    {
                        Emit("cancelled", new JsonObject { ["reason"] = "Cancellation requested after tool execution" });
                        result.Error = CancelledError;
                        cancelled = true;
                        break;
                    }
                }

                if (cancelled)
                {
                    result.Conversation = conversation;
                    return result;
                }

                Emit("messages_updated", new JsonObject { ["message_count"] = conversation.Count + 1 });

                if (result.Iterations > maxIterations)
                {
                    result.Error = $"Agent loop exceeded {maxIterations} iterations";
                    result.Conversation = conversation;
                    return result;
                }

                continue;
            }

            result.Result = response.Content;
            conversation.Add(new JsonObject { ["role"] = "assistant", ["content"] = response.Content });
            Emit("done", new JsonObject { ["response"] = response.Content });
            result.Conversation = conversation;
            return result;
        }
    }

    private static JsonObject AssistantToolCallsMessage(AgentModelResponse response)
    {
        JsonArray toolCalls;
        if (response.RawToolCalls is not null)
        {
            toolCalls = (JsonArray)response.RawToolCalls.DeepClone();
        }
        else
        {
            toolCalls = [];
            foreach (var tc in response.ToolCalls)
            {
                toolCalls.Add(new JsonObject
                {
                    ["id"] = tc.Id,
                    ["type"] = "function",
                    ["function"] = new JsonObject { ["name"] = tc.Name, ["arguments"] = tc.Arguments },
                });
            }
        }

        return new JsonObject
        {
            ["role"] = "assistant",
            ["content"] = "",
            ["metadata"] = new JsonObject { ["tool_calls"] = toolCalls },
        };
    }

    private static JsonObject ToolMessage(string callId, string content) => new()
    {
        ["role"] = "tool",
        ["content"] = content,
        ["metadata"] = new JsonObject { ["tool_call_id"] = callId },
    };

    private static int CharCount(IEnumerable<JsonObject> messages)
    {
        var total = 0;
        foreach (var m in messages)
        {
            if (m["content"] is JsonValue value && value.TryGetValue<string>(out var content))
                total += content.Length;
        }
        return total;
    }

    private static JsonObject ParseArgs(string arguments)
    {
        if (string.IsNullOrEmpty(arguments))
            return [];
        try
        {
            return JsonNode.Parse(arguments) as JsonObject ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static string DefaultSummary(IEnumerable<JsonObject> droppedUsers)
    {
        var topics = new List<string>();
        foreach (var m in droppedUsers)
        {
            if (m["content"] is JsonValue value && value.TryGetValue<string>(out var content))
            {
                var trimmed = content.Trim();
                if (trimmed.Length > 0)
                    topics.Add(trimmed);
            }
        }
        return SummaryPrefix + "User asked about " + string.Join("; ", topics);
    }

    private static List<JsonObject>? MaybeTrim(
        List<JsonObject> conversation,
        int? contextBudget,
        Func<List<JsonObject>, string>? summarize)
    {
        if (contextBudget is null || CharCount(conversation) <= contextBudget.Value)
            return null;

        var systems = conversation
            .Where(m => (m["role"] as JsonValue)?.GetValue<string>() == "system")
            .Select(m => (JsonObject)m.DeepClone())
            .ToList();
        var users = conversation
            .Where(m => (m["role"] as JsonValue)?.GetValue<string>() == "user")
            .ToList();
        var droppedUsers = users.Count > 0 ? users.Take(users.Count - 1).ToList() : [];
        var lastUser = users.Count > 0 ? users[^1] : null;

        var summaryText = summarize is not null ? summarize(droppedUsers) : DefaultSummary(droppedUsers);
        var summaryMessage = new JsonObject { ["role"] = "system", ["content"] = summaryText };

        var trimmed = new List<JsonObject>(systems) { summaryMessage };
        if (lastUser is not null)
            trimmed.Add(new JsonObject { ["role"] = "user", ["content"] = lastUser["content"]?.DeepClone() });
        return trimmed;
    }
}
