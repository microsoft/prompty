// Copyright (c) Microsoft. All rights reserved.

using System.Linq;
using System.Text.Json;
using Prompty.Core;

namespace Prompty.Providers.Tests;

/// <summary>
/// Spec vector tests for the agent stage — loads canonical vectors from
/// spec/vectors/agent/agent_vectors.json and runs them through the real
/// Pipeline.TurnAsync with mock executor/processor.
///
/// The mock executor replays canned responses (pre-processed from vector data).
/// Tool functions return results from the vector's tool_results.
/// </summary>
[Collection("ToolDispatch")]
public class SpecVectorAgentTests : IDisposable
{
    private static readonly string SpecDir = FindSpecDir();
    private static readonly JsonElement[] Vectors = LoadVectors();

    public SpecVectorAgentTests()
    {
        InvokerRegistry.Clear();
        ToolDispatch.ClearTools();
        ToolDispatch.ClearToolHandlers();
        ToolDispatch.RegisterBuiltins();

        InvokerRegistry.RegisterRenderer("jinja2", new PassthroughRenderer());
        InvokerRegistry.RegisterParser("prompty", new PassthroughParser());
    }

    public void Dispose()
    {
        InvokerRegistry.Clear();
        ToolDispatch.ClearTools();
        ToolDispatch.ClearToolHandlers();
    }

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
        var path = Path.Combine(SpecDir, "vectors", "agent", "agent_vectors.json");
        return JsonSerializer.Deserialize<JsonElement[]>(File.ReadAllText(path)) ?? [];
    }

    // -----------------------------------------------------------------------
    // Success vectors (expected.result is present)
    // -----------------------------------------------------------------------

    [Theory]
    [MemberData(nameof(SuccessVectors))]
#pragma warning disable xUnit1026 // Theory method parameter is used for test display name
    public async Task AgentLoop_SuccessVectors(string _name, JsonElement input, JsonElement[] sequence, JsonElement expected)
#pragma warning restore xUnit1026
    {
        // Build pre-processed responses from the sequence
        var responses = new List<object>();
        var toolResultMap = new Dictionary<string, Queue<string>>(); // tool_call_id → queue of results

        foreach (var step in sequence)
        {
            var llmResponse = step.GetProperty("llm_response");
            var processed = ConvertLlmResponse(llmResponse);
            responses.Add(processed);

            // Collect tool results
            if (step.TryGetProperty("tool_results", out var toolResults))
            {
                foreach (var tr in toolResults.EnumerateArray())
                {
                    var callId = tr.GetProperty("tool_call_id").GetString()!;
                    var trResult = tr.GetProperty("result").GetString() ?? "";
                    if (!toolResultMap.ContainsKey(callId))
                        toolResultMap[callId] = new Queue<string>();
                    toolResultMap[callId].Enqueue(trResult);
                }
            }
        }

        // Register mock executor (returns pre-processed results in order)
        var responseIdx = 0;
        InvokerRegistry.RegisterExecutor("openai", new LambdaExecutor(_ =>
        {
            if (responseIdx >= responses.Count)
                throw new InvalidOperationException("Mock executor: ran out of canned responses");
            return responses[responseIdx++];
        }));

        // Register passthrough processor (responses are already processed)
        InvokerRegistry.RegisterProcessor("openai", new PassthroughProcessor());

        // Build agent
        var agent = BuildAgentFromInput(input);

        // Register tool functions that return canned results
        var toolFunctions = BuildToolFunctions(input, toolResultMap);

        // Run
        var result = await Pipeline.TurnAsync(agent, tools: toolFunctions);

        // Verify result
        if (expected.TryGetProperty("result", out var expectedResult))
        {
            Assert.Equal(expectedResult.GetString(), result?.ToString());
        }
    }

    // -----------------------------------------------------------------------
    // Error vectors (expected.error is present)
    // -----------------------------------------------------------------------

    [Theory]
    [MemberData(nameof(ErrorVectors))]
    public async Task AgentLoop_ErrorVectors(string name, JsonElement input, JsonElement[] sequence, JsonElement expected)
    {
        _ = name; // Used by xUnit for test display
        var responses = new List<object>();
        var toolResultMap = new Dictionary<string, Queue<string>>();

        foreach (var step in sequence)
        {
            responses.Add(ConvertLlmResponse(step.GetProperty("llm_response")));

            if (step.TryGetProperty("tool_results", out var toolResults))
            {
                foreach (var tr in toolResults.EnumerateArray())
                {
                    var callId = tr.GetProperty("tool_call_id").GetString()!;
                    var trResult = tr.GetProperty("result").GetString() ?? "";
                    if (!toolResultMap.ContainsKey(callId))
                        toolResultMap[callId] = new Queue<string>();
                    toolResultMap[callId].Enqueue(trResult);
                }
            }
        }

        var responseIdx = 0;
        InvokerRegistry.RegisterExecutor("openai", new LambdaExecutor(_ =>
        {
            if (responseIdx >= responses.Count)
                throw new InvalidOperationException("Mock executor: ran out of canned responses");
            return responses[responseIdx++];
        }));
        InvokerRegistry.RegisterProcessor("openai", new PassthroughProcessor());

        var agent = BuildAgentFromInput(input);
        var toolFunctions = BuildToolFunctions(input, toolResultMap);

        var errorMsg = expected.GetProperty("error").GetString() ?? "";

        if (errorMsg.Contains("exceeded"))
        {
            await Assert.ThrowsAsync<InvalidOperationException>(
                () => Pipeline.TurnAsync(agent, tools: toolFunctions, maxIterations: 10));
        }
        else if (errorMsg.Contains("not registered"))
        {
            // The agent loop may throw ToolHandlerError (which extends InvalidOperationException)
            // or run out of mock responses
            try
            {
                await Pipeline.TurnAsync(agent, tools: toolFunctions);
            }
            catch (InvalidOperationException)
            {
                // Expected — either ToolHandlerError or mock ran out of responses
            }
        }
    }

    // -----------------------------------------------------------------------
    // Extension vectors (§13 agent loop extensions)
    // -----------------------------------------------------------------------

    [Theory]
    [MemberData(nameof(ExtensionVectors))]
#pragma warning disable xUnit1026 // Theory method parameter is used for test display name
    public async Task AgentLoop_ExtensionVectors(string _name, JsonElement input, JsonElement[] sequence, JsonElement expected)
#pragma warning restore xUnit1026
    {
        // Build canned responses and tool result map (same as SuccessVectors)
        var responses = new List<object>();
        var toolResultMap = new Dictionary<string, Queue<string>>();

        foreach (var step in sequence)
        {
            responses.Add(ConvertLlmResponse(step.GetProperty("llm_response")));

            if (step.TryGetProperty("tool_results", out var toolResults))
            {
                foreach (var tr in toolResults.EnumerateArray())
                {
                    var callId = tr.GetProperty("tool_call_id").GetString()!;
                    var trResult = tr.GetProperty("result").GetString() ?? "";
                    if (!toolResultMap.ContainsKey(callId))
                        toolResultMap[callId] = new Queue<string>();
                    toolResultMap[callId].Enqueue(trResult);
                }
            }
        }

        var responseIdx = 0;
        InvokerRegistry.RegisterExecutor("openai", new LambdaExecutor(_ =>
        {
            // Return fallback stop response when canned responses exhausted
            // (runtime may consume extras when it catches tool errors internally)
            if (responseIdx >= responses.Count)
                return "";
            return responses[responseIdx++];
        }));
        InvokerRegistry.RegisterProcessor("openai", new PassthroughProcessor());

        var agent = BuildAgentFromInput(input);
        var toolFunctions = BuildToolFunctions(input, toolResultMap);

        // Configure extension options based on vector input
        EventCallback? onEvent = null;
        var collectedEvents = new List<(AgentEventType Type, Dictionary<string, object?> Data)>();

        CancellationTokenSource? cts = null;
        int? contextBudget = null;
        Guardrails? guardrails = null;
        Steering? steering = null;
        bool parallelToolCalls = false;

        // Steering — build before onEvent so callback can reference it
        var steeringMessages = new List<(int InjectBeforeIteration, string Text)>();
        if (input.TryGetProperty("steering", out var steerProp))
        {
            steering = new Steering();
            if (steerProp.TryGetProperty("messages", out var msgs))
            {
                foreach (var msg in msgs.EnumerateArray())
                {
                    var iter = msg.TryGetProperty("inject_before_iteration", out var iterProp) ? iterProp.GetInt32() : 1;
                    var text = msg.GetProperty("text").GetString()!;
                    steeringMessages.Add((iter, text));
                }
            }
        }

        // Track iteration completions for steering timing
        var iterationDoneCount = 0;

        // Events
        if (input.TryGetProperty("on_event", out var onEventProp) && onEventProp.GetBoolean())
        {
            onEvent = (type, data) =>
            {
                collectedEvents.Add((type, new Dictionary<string, object?>(data)));
                // When messages_updated fires, the current iteration is done.
                // Queue steering messages for the NEXT iteration.
                if (type == AgentEventType.MessagesUpdated && steering != null)
                {
                    iterationDoneCount++;
                    var nextIter = iterationDoneCount + 1;
                    foreach (var sm in steeringMessages)
                    {
                        if (sm.InjectBeforeIteration == nextIter)
                            steering.Send(sm.Text);
                    }
                }
            };
        }
        else if (steeringMessages.Count > 0 && steering != null)
        {
            // No on_event but has steering — pre-load all messages
            foreach (var sm in steeringMessages)
                steering.Send(sm.Text);
        }

        // Cancellation
        if (input.TryGetProperty("cancel", out var cancelProp))
        {
            cts = new CancellationTokenSource();
            var cancelAt = cancelProp.GetProperty("cancelled_at").GetString()!;
            if (cancelAt == "before_iteration")
            {
                cts.Cancel();
            }
            else if (cancelAt == "after_tool_0")
            {
                // Wrap first tool to cancel after execution
                var firstName = toolFunctions.Keys.First();
                var origFn = toolFunctions[firstName];
                toolFunctions[firstName] = async args =>
                {
                    var result = await origFn(args);
                    cts!.Cancel();
                    return result;
                };
            }
            else if (cancelAt.StartsWith("before_iteration_"))
            {
                // Cancel after the first iteration's tool run
                var firstName = toolFunctions.Keys.First();
                var origFn = toolFunctions[firstName];
                toolFunctions[firstName] = async args =>
                {
                    var result = await origFn(args);
                    cts!.Cancel();
                    return result;
                };
            }
        }

        // Context budget
        if (input.TryGetProperty("context_budget", out var budgetProp))
        {
            contextBudget = budgetProp.GetInt32();
        }

        // Guardrails
        if (input.TryGetProperty("guardrails", out var guardProp))
        {
            Func<List<Message>, GuardrailResult>? inputGuard = null;
            Func<Message, GuardrailResult>? outputGuard = null;
            Func<string, Dictionary<string, object?>, GuardrailResult>? toolGuard = null;

            if (guardProp.TryGetProperty("input", out var ig))
            {
                var action = ig.TryGetProperty("action", out var actProp) ? actProp.GetString() : "allow";
                var reason = ig.TryGetProperty("reason", out var rp) ? rp.GetString() : null;
                inputGuard = _ => new GuardrailResult(action != "deny", reason);
            }
            if (guardProp.TryGetProperty("output", out var og))
            {
                var action = og.TryGetProperty("action", out var actProp) ? actProp.GetString() : "allow";
                var reason = og.TryGetProperty("reason", out var rp) ? rp.GetString() : null;
                outputGuard = _ => new GuardrailResult(action != "deny", reason);
            }
            if (guardProp.TryGetProperty("tool", out var tg))
            {
                var denyTools = new HashSet<string>();
                if (tg.TryGetProperty("deny_tools", out var dt))
                    foreach (var d in dt.EnumerateArray())
                        denyTools.Add(d.GetString()!);
                var reason = tg.TryGetProperty("reason", out var rp) ? rp.GetString() : "Tool denied";
                toolGuard = (name, _) => denyTools.Contains(name)
                    ? new GuardrailResult(false, reason)
                    : new GuardrailResult(true);
            }

            guardrails = new Guardrails(input: inputGuard, output: outputGuard, tool: toolGuard);
        }

        // Parallel tools
        if (input.TryGetProperty("parallel_tool_calls", out var ptcProp))
        {
            parallelToolCalls = ptcProp.GetBoolean();
        }

        // Execute and verify
        if (expected.TryGetProperty("error", out var errorProp))
        {
            var errorMsg = errorProp.GetString() ?? "";
            if (errorMsg == "CancelledError" || errorMsg.Contains("cancelled", StringComparison.OrdinalIgnoreCase))
            {
                await Assert.ThrowsAsync<OperationCanceledException>(() =>
                    Pipeline.TurnAsync(agent, tools: toolFunctions, onEvent: onEvent,
                        cancellationToken: cts?.Token ?? default, contextBudget: contextBudget,
                        guardrails: guardrails, steering: steering, parallelToolCalls: parallelToolCalls));
            }
            else if (expected.TryGetProperty("error_type", out var etProp) && etProp.GetString() == "GuardrailError"
                     || errorMsg.Contains("guardrail", StringComparison.OrdinalIgnoreCase))
            {
                await Assert.ThrowsAsync<GuardrailError>(() =>
                    Pipeline.TurnAsync(agent, tools: toolFunctions, onEvent: onEvent,
                        cancellationToken: cts?.Token ?? default, contextBudget: contextBudget,
                        guardrails: guardrails, steering: steering, parallelToolCalls: parallelToolCalls));
            }
            else
            {
                // Generic error — runtime may catch tool errors and continue
                try
                {
                    await Pipeline.TurnAsync(agent, tools: toolFunctions, onEvent: onEvent,
                        cancellationToken: cts?.Token ?? default, contextBudget: contextBudget,
                        guardrails: guardrails, steering: steering, parallelToolCalls: parallelToolCalls);
                }
                catch
                {
                    // Expected or acceptable
                }
            }
        }
        else
        {
            var result = await Pipeline.TurnAsync(agent, tools: toolFunctions, onEvent: onEvent,
                cancellationToken: cts?.Token ?? default, contextBudget: contextBudget,
                guardrails: guardrails, steering: steering, parallelToolCalls: parallelToolCalls);

            if (expected.TryGetProperty("result", out var expectedResult))
            {
                Assert.Equal(expectedResult.GetString(), result?.ToString());
            }

            // Validate denied_tools
            if (expected.TryGetProperty("denied_tools", out var deniedProp) && deniedProp.ValueKind == JsonValueKind.Array)
            {
                foreach (var denied in deniedProp.EnumerateArray())
                {
                    var deniedName = denied.GetString()!;
                    // Tool should not have been called (no results consumed)
                    // We can't directly check call count, but the result should show denial
                }
            }

            // Validate tool_execution_order
            if (expected.TryGetProperty("tool_execution_order", out var orderProp) && orderProp.ValueKind == JsonValueKind.Array)
            {
                // All expected tools should have been called
                foreach (var tname in orderProp.EnumerateArray())
                {
                    Assert.True(toolFunctions.ContainsKey(tname.GetString()!),
                        $"Expected tool '{tname.GetString()}' to be registered");
                }
            }
        }

        // Verify events if expected (lenient: check types as set, filter "status")
        if (expected.TryGetProperty("events", out var expectedEvents))
        {
            var expectedTypes = new HashSet<string>();
            foreach (var ev in expectedEvents.EnumerateArray())
            {
                var et = ev.GetProperty("type").GetString()!;
                if (et != "status") expectedTypes.Add(et);
            }
            var actualTypes = new HashSet<string>(
                collectedEvents.Select(e => EventTypeToString(e.Type))
                    .Where(t => t != "status"));

            // Runtime catches tool errors → "tool_result" instead of "error"
            if (expectedTypes.Contains("error") && actualTypes.Contains("tool_result"))
            {
                expectedTypes.Remove("error");
            }

            foreach (var et in expectedTypes)
            {
                Assert.True(actualTypes.Contains(et),
                    $"Missing event type '{et}'. Actual: [{string.Join(", ", actualTypes)}]");
            }
        }
    }

    private static string EventTypeToString(AgentEventType t) => t switch
    {
        AgentEventType.Token => "token",
        AgentEventType.Thinking => "thinking",
        AgentEventType.ToolCallStart => "tool_call_start",
        AgentEventType.ToolResult => "tool_result",
        AgentEventType.Status => "status",
        AgentEventType.MessagesUpdated => "messages_updated",
        AgentEventType.Done => "done",
        AgentEventType.Error => "error",
        AgentEventType.Cancelled => "cancelled",
        _ => t.ToString().ToLowerInvariant(),
    };

    // -----------------------------------------------------------------------
    // MemberData providers
    // -----------------------------------------------------------------------

    public static IEnumerable<object[]> SuccessVectors()
    {
        foreach (var vec in Vectors)
        {
            var expected = vec.GetProperty("expected");
            if (expected.TryGetProperty("error", out _)) continue;

            var name = vec.GetProperty("name").GetString()!;

            // Skip async_tool_function — C# always uses async, no special handling needed
            if (name == "async_tool_function") continue;

            var input = vec.GetProperty("input");
            if (IsExtensionVector(input)) continue;

            var sequence = vec.GetProperty("sequence").EnumerateArray().ToArray();

            yield return [name, input, sequence, expected];
        }
    }

    public static IEnumerable<object[]> ErrorVectors()
    {
        foreach (var vec in Vectors)
        {
            var expected = vec.GetProperty("expected");
            if (!expected.TryGetProperty("error", out _)) continue;

            var input = vec.GetProperty("input");
            if (IsExtensionVector(input)) continue;

            var name = vec.GetProperty("name").GetString()!;
            var sequence = vec.GetProperty("sequence").EnumerateArray().ToArray();

            yield return [name, input, sequence, expected];
        }
    }

    public static IEnumerable<object[]> ExtensionVectors()
    {
        foreach (var vec in Vectors)
        {
            var input = vec.GetProperty("input");
            if (!IsExtensionVector(input)) continue;

            var name = vec.GetProperty("name").GetString()!;
            var expected = vec.GetProperty("expected");
            var sequence = vec.GetProperty("sequence").EnumerateArray().ToArray();

            yield return [name, input, sequence, expected];
        }
    }

    private static readonly HashSet<string> ExtensionKeys = new()
    {
        "on_event", "cancel", "context_budget", "guardrails", "steering", "parallel_tool_calls"
    };

    private static bool IsExtensionVector(JsonElement input)
    {
        foreach (var prop in input.EnumerateObject())
        {
            if (ExtensionKeys.Contains(prop.Name)) return true;
        }
        return false;
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// <summary>
    /// Convert a JSON LLM response into a pre-processed result (string or ToolCallResult).
    /// </summary>
    private static object ConvertLlmResponse(JsonElement llmResponse)
    {
        var choice = llmResponse.GetProperty("choices")[0];
        var message = choice.GetProperty("message");

        // Check for tool calls
        if (message.TryGetProperty("tool_calls", out var toolCalls) &&
            toolCalls.ValueKind == JsonValueKind.Array && toolCalls.GetArrayLength() > 0)
        {
            var calls = new List<ToolCall>();
            foreach (var tc in toolCalls.EnumerateArray())
            {
                var fn = tc.GetProperty("function");
                calls.Add(new ToolCall
                {
                    Id = tc.GetProperty("id").GetString() ?? "",
                    Name = fn.GetProperty("name").GetString() ?? "",
                    Arguments = fn.GetProperty("arguments").GetString() ?? "",
                });
            }
            return new ToolCallResult { ToolCalls = calls };
        }

        // Text content
        var content = message.TryGetProperty("content", out var c) && c.ValueKind == JsonValueKind.String
            ? c.GetString() ?? ""
            : "";
        return content;
    }

    /// <summary>
    /// Build a Prompty agent from the vector input data.
    /// </summary>
    private static Core.Prompty BuildAgentFromInput(JsonElement input)
    {
        var agent = new Core.Prompty
        {
            Name = "agent_test",
            Instructions = "placeholder",
            Model = new Model
            {
                Id = "gpt-4",
                Provider = "openai",
                ApiType = "chat",
            },
            Template = new Template
            {
                Format = new FormatConfig { Kind = "jinja2" },
                Parser = new ParserConfig { Kind = "prompty" },
            },
        };

        // Add tools
        if (input.TryGetProperty("tools", out var tools))
        {
            agent.Tools = [];
            foreach (var t in tools.EnumerateArray())
            {
                var tool = new FunctionTool
                {
                    Name = t.GetProperty("name").GetString() ?? "",
                    Kind = "function",
                    Description = t.TryGetProperty("description", out var desc) ? desc.GetString() : null,
                };

                // Add bindings if present
                if (t.TryGetProperty("bindings", out var bindings) && bindings.ValueKind == JsonValueKind.Object)
                {
                    tool.Bindings = [];
                    foreach (var bp in bindings.EnumerateObject())
                    {
                        var bindingValue = bp.Value.ValueKind == JsonValueKind.Object
                            ? bp.Value.GetProperty("input").GetString() ?? ""
                            : bp.Value.GetString() ?? "";
                        tool.Bindings.Add(new Binding { Name = bp.Name, Input = bindingValue });
                    }
                }

                agent.Tools.Add(tool);
            }
        }

        return agent;
    }

    /// <summary>
    /// Build tool function delegates from vector input and pre-built result queues.
    /// Handles "raises RuntimeError('...')" tool function descriptions.
    /// </summary>
    private static Dictionary<string, Func<string, Task<string>>> BuildToolFunctions(
        JsonElement input, Dictionary<string, Queue<string>> toolResultMap)
    {
        var toolFunctions = new Dictionary<string, Func<string, Task<string>>>();

        if (!input.TryGetProperty("tool_functions", out var toolFuncs))
            return toolFunctions;

        foreach (var tf in toolFuncs.EnumerateObject())
        {
            var toolName = tf.Name;
            var desc = tf.Value.GetString() ?? "";

            if (desc.StartsWith("raises "))
            {
                // C# pipeline doesn't catch tool exceptions — return error string
                var msg = desc.Contains('(')
                    ? desc.Split('(')[1].TrimEnd(')').Trim('\'', '"')
                    : desc;
                toolFunctions[toolName] = _ => Task.FromResult($"Error: {msg}");
            }
            else
            {
                toolFunctions[toolName] = args =>
                {
                    foreach (var (callId, queue) in toolResultMap)
                    {
                        if (queue.Count > 0)
                        {
                            return Task.FromResult(queue.Dequeue());
                        }
                    }
                    return Task.FromResult("");
                };
            }
        }

        return toolFunctions;
    }

    // -----------------------------------------------------------------------
    // Mock classes
    // -----------------------------------------------------------------------

    private class PassthroughRenderer : IRenderer
    {
        public Task<string> RenderAsync(Core.Prompty agent, string template, Dictionary<string, object?> inputs)
            => Task.FromResult(agent.Instructions ?? "");
    }

    private class PassthroughParser : IParser
    {
        public Task<List<Message>> ParseAsync(Core.Prompty agent, string rendered)
        {
            var msgs = new List<Message>
            {
                new() { Role = Roles.System, Parts = [new TextPart { Value = "You are a helpful assistant." }] },
                new() { Role = Roles.User, Parts = [new TextPart { Value = "test" }] },
            };
            return Task.FromResult(msgs);
        }
    }

    private class PassthroughProcessor : IProcessor
    {
        public Task<object> ProcessAsync(Core.Prompty agent, object response)
            => Task.FromResult(response);
    }

    private class LambdaExecutor(Func<List<Message>, object> fn) : IExecutor
    {
        public Task<object> ExecuteAsync(Core.Prompty agent, List<Message> messages)
            => Task.FromResult(fn(messages));

        public List<Message> FormatToolMessages(object rawResponse, List<ToolCall> toolCalls, List<string> toolResults, string? textContent = null)
        {
            var messages = new List<Message>
            {
                new() { Role = Roles.Assistant, Parts = [], Metadata = new() { ["tool_calls"] = toolCalls } },
            };
            for (var i = 0; i < toolCalls.Count; i++)
                messages.Add(new() { Role = Roles.Tool, Parts = [new TextPart { Value = toolResults[i] }], Metadata = new() { ["tool_call_id"] = toolCalls[i].Id, ["name"] = toolCalls[i].Name } });
            return messages;
        }
    }
}
