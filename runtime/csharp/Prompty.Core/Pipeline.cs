// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core.Tracing;

namespace Prompty.Core;

/// <summary>
/// Orchestrates the Prompty pipeline: render → parse → execute → process.
/// All methods accept either a file path or a pre-loaded Prompty instance.
/// </summary>
public static class Pipeline
{
    // -----------------------------------------------------------------------
    // Input Validation
    // -----------------------------------------------------------------------

    /// <summary>
    /// Validates inputs against the agent's declared input schema.
    /// Fills in defaults for missing optional inputs.
    /// </summary>
    public static Dictionary<string, object?> ValidateInputs(Prompty agent, Dictionary<string, object?>? inputs)
    {
        var result = inputs is not null
            ? new Dictionary<string, object?>(inputs)
            : new Dictionary<string, object?>();

        if (agent.Inputs is null || agent.Inputs.Count == 0)
            return result;

        foreach (var prop in agent.Inputs)
        {
            if (string.IsNullOrEmpty(prop.Name))
                continue;

            if (result.ContainsKey(prop.Name))
                continue;

            if (prop.Default is not null)
            {
                result[prop.Name] = prop.Default;
            }
            else if (prop.Example is not null)
            {
                result[prop.Name] = prop.Example;
            }
            else if (prop.Required == true)
            {
                throw new ArgumentException(
                    $"Required input '{prop.Name}' is missing and has no default value.");
            }
        }

        return result;
    }

    // -----------------------------------------------------------------------
    // Pipeline Steps
    // -----------------------------------------------------------------------

    /// <summary>
    /// Render the agent's instructions template with the given inputs.
    /// </summary>
    public static async Task<string> RenderAsync(Prompty agent, Dictionary<string, object?> inputs)
    {
        return await Trace.TraceAsync<string>("Prompty.Core.Pipeline.RenderAsync", async (emit) =>
        {
            emit("inputs", new Dictionary<string, object?> { ["agent"] = agent.Name, ["inputs"] = inputs });
            var formatKind = agent.Template?.Format?.Kind ?? "jinja2";
            var renderer = InvokerRegistry.GetRenderer(formatKind);
            var template = agent.Instructions ?? "";
            var result = await renderer.RenderAsync(agent, template, inputs);
            return result;
        });
    }

    /// <summary>
    /// Parse rendered text into a list of Messages.
    /// </summary>
    public static async Task<List<Message>> ParseAsync(Prompty agent, string rendered)
    {
        return await Trace.TraceAsync<List<Message>>("Prompty.Core.Pipeline.ParseAsync", async (emit) =>
        {
            emit("inputs", new Dictionary<string, object?> { ["agent"] = agent.Name });
            var parserKind = agent.Template?.Parser?.Kind ?? "prompty";
            var parser = InvokerRegistry.GetParser(parserKind);
            return await parser.ParseAsync(agent, rendered);
        });
    }

    /// <summary>
    /// Execute an LLM call with the given messages.
    /// </summary>
    public static async Task<object> ExecuteAsync(Prompty agent, List<Message> messages)
    {
        return await Trace.TraceAsync<object>("Prompty.Core.Pipeline.ExecuteAsync", async (emit) =>
        {
            emit("inputs", new Dictionary<string, object?> { ["agent"] = agent.Name, ["message_count"] = messages.Count });
            var provider = agent.Model?.Provider ?? "openai";
            var executor = InvokerRegistry.GetExecutor(provider);
            return await executor.ExecuteAsync(agent, messages);
        });
    }

    /// <summary>
    /// Post-process a raw LLM response.
    /// </summary>
    public static async Task<object> ProcessAsync(Prompty agent, object response)
    {
        return await Trace.TraceAsync<object>("Prompty.Core.Pipeline.ProcessAsync", async (emit) =>
        {
            emit("inputs", new Dictionary<string, object?> { ["agent"] = agent.Name });
            var provider = agent.Model?.Provider ?? "openai";
            var processor = InvokerRegistry.GetProcessor(provider);
            return await processor.ProcessAsync(agent, response);
        });
    }

    // -----------------------------------------------------------------------
    // Composed Operations
    // -----------------------------------------------------------------------

    /// <summary>
    /// Render + Parse: produce messages ready for execution.
    /// Handles input validation, template rendering, parsing, and thread expansion.
    /// </summary>
    public static async Task<List<Message>> PrepareAsync(
        Prompty agent,
        Dictionary<string, object?>? inputs = null)
    {
        return await Trace.TraceAsync<List<Message>>("Prompty.Core.Pipeline.PrepareAsync", async (emit) =>
        {
            emit("inputs", new Dictionary<string, object?> { ["agent"] = agent.Name, ["inputs"] = inputs });
            var validatedInputs = ValidateInputs(agent, inputs);

            var parserKind = agent.Template?.Parser?.Kind ?? "prompty";
            var parser = InvokerRegistry.GetParser(parserKind);

            string rendered;
            Dictionary<string, object?>? parserContext = null;

            if (parser is IPreRenderable preRenderable)
            {
                var (sanitized, ctx) = preRenderable.PreRender(agent.Instructions ?? "");
                parserContext = ctx;
                var formatKind = agent.Template?.Format?.Kind ?? "jinja2";
                var renderer = InvokerRegistry.GetRenderer(formatKind);
                rendered = await renderer.RenderAsync(agent, sanitized, validatedInputs);
            }
            else
            {
                rendered = await RenderAsync(agent, validatedInputs);
            }

            var messages = await parser.ParseAsync(agent, rendered);
            messages = ExpandThreadMarkers(messages, validatedInputs);
            return messages;
        });
    }

    /// <summary>
    /// Execute + Process: send messages to LLM and post-process the response.
    /// </summary>
    public static async Task<object> RunAsync(
        Prompty agent,
        List<Message> messages,
        bool raw = false)
    {
        var response = await ExecuteAsync(agent, messages);
        if (raw) return response;
        return await ProcessAsync(agent, response);
    }

    /// <summary>
    /// Full pipeline: Load (if path) → Prepare → Run.
    /// </summary>
    public static async Task<object> InvokeAsync(
        string path,
        Dictionary<string, object?>? inputs = null,
        bool raw = false)
    {
        return await Trace.TraceAsync<object>("Prompty.Core.Pipeline.InvokeAsync", async (emit) =>
        {
            emit("inputs", new Dictionary<string, object?> { ["path"] = path, ["inputs"] = inputs });
            var agent = PromptyLoader.Load(path);
            return await InvokeAsync(agent, inputs, raw);
        });
    }

    /// <summary>
    /// Full pipeline: Prepare → Run.
    /// </summary>
    public static async Task<object> InvokeAsync(
        Prompty agent,
        Dictionary<string, object?>? inputs = null,
        bool raw = false)
    {
        return await Trace.TraceAsync<object>("Prompty.Core.Pipeline.InvokeAsync", async (emit) =>
        {
            emit("inputs", new Dictionary<string, object?> { ["agent"] = agent.Name, ["inputs"] = inputs });
            var messages = await PrepareAsync(agent, inputs);
            return await RunAsync(agent, messages, raw);
        });
    }

    // -----------------------------------------------------------------------
    // Agent Loop
    // -----------------------------------------------------------------------

    /// <summary>
    /// Agent mode: runs the LLM in a loop, executing tool calls via the
    /// two-layer dispatch system until the model returns a final response
    /// or maxIterations is reached. Supports §13 extensions: cancellation,
    /// steering, context window trimming, guardrails, events, and parallel tool calls.
    /// </summary>
    public static async Task<object> InvokeAgentAsync(
        Prompty agent,
        Dictionary<string, object?>? inputs = null,
        Dictionary<string, Func<string, Task<string>>>? tools = null,
        int maxIterations = 10,
        bool raw = false,
        EventCallback? onEvent = null,
        CancellationToken cancellationToken = default,
        int? contextBudget = null,
        Guardrails? guardrails = null,
        Steering? steering = null,
        bool parallelToolCalls = false)
    {
        return await Trace.TraceAsync<object>("Prompty.Core.Pipeline.InvokeAgentAsync", async (emit) =>
        {
            emit("inputs", new Dictionary<string, object?> { ["agent"] = agent.Name, ["maxIterations"] = maxIterations });
            var messages = await PrepareAsync(agent, inputs);
            var executor = InvokerRegistry.GetExecutor(agent.Model?.Provider ?? "openai");

            object? response = null;
            int iteration = 0;

            while (true)
            {
                if (iteration >= maxIterations)
                {
                    throw new InvalidOperationException(
                        $"Agent loop exceeded maximum iterations ({maxIterations}).");
                }

                // §13.2 Cancellation check at loop start
                try
                {
                    cancellationToken.ThrowIfCancellationRequested();
                }
                catch (OperationCanceledException)
                {
                    AgentEvents.EmitEvent(onEvent, AgentEventType.Cancelled,
                        new Dictionary<string, object?> { ["iteration"] = iteration, ["reason"] = "cancellation_requested" });
                    throw;
                }

                // §13.5 Drain steering messages
                if (steering is not null)
                {
                    var steered = steering.Drain();
                    if (steered.Count > 0)
                    {
                        messages.AddRange(steered);
                        AgentEvents.EmitEvent(onEvent, AgentEventType.MessagesUpdated,
                            new Dictionary<string, object?> { ["source"] = "steering", ["count"] = steered.Count });
                    }
                }

                // §13.3 Context window trimming
                if (contextBudget is not null)
                {
                    var (droppedCount, _) = ContextWindow.TrimToContextWindow(messages, contextBudget.Value);
                    if (droppedCount > 0)
                    {
                        AgentEvents.EmitEvent(onEvent, AgentEventType.MessagesUpdated,
                            new Dictionary<string, object?> { ["source"] = "context_trim", ["dropped"] = droppedCount });
                    }
                }

                // §13.4 Input guardrail
                if (guardrails is not null)
                {
                    var inputCheck = guardrails.CheckInput(messages);
                    if (!inputCheck.Allowed)
                    {
                        AgentEvents.EmitEvent(onEvent, AgentEventType.Error,
                            new Dictionary<string, object?> { ["guardrail"] = "input", ["reason"] = inputCheck.Reason });
                        throw new GuardrailError(inputCheck.Reason ?? "Input guardrail denied");
                    }
                    if (inputCheck.Rewrite is List<Message> rewrittenMessages)
                    {
                        messages = rewrittenMessages;
                    }
                }

                // §13.2 Cancellation check before LLM call
                try
                {
                    cancellationToken.ThrowIfCancellationRequested();
                }
                catch (OperationCanceledException)
                {
                    AgentEvents.EmitEvent(onEvent, AgentEventType.Cancelled,
                        new Dictionary<string, object?> { ["iteration"] = iteration, ["reason"] = "cancelled_before_llm" });
                    throw;
                }

                AgentEvents.EmitEvent(onEvent, AgentEventType.Status,
                    new Dictionary<string, object?> { ["iteration"] = iteration, ["phase"] = "executing" });

                response = await ExecuteAsync(agent, messages);

                // If response is a stream, consume it fully before processing.
                // This ensures tool calls from streaming responses are gathered.
                if (response is PromptyStream stream)
                {
                    await foreach (var chunk in stream)
                    {
                        if (chunk is string tokenText && tokenText.Length > 0)
                        {
                            AgentEvents.EmitEvent(onEvent, AgentEventType.Token,
                                new Dictionary<string, object?> { ["token"] = tokenText });
                        }
                    }
                    response = stream;
                }

                var result = raw ? response! : await ProcessAsync(agent, response!);

                if (result is ToolCallResult toolResult && toolResult.ToolCalls.Count > 0)
                {
                    // Dispatch tool calls (parallel or sequential)
                    var toolResults = new List<string>();

                    if (parallelToolCalls && toolResult.ToolCalls.Count > 1)
                    {
                        // Parallel dispatch via Task.WhenAll
                        var tasks = new List<Task<(int Index, string Result)>>();
                        for (int ti = 0; ti < toolResult.ToolCalls.Count; ti++)
                        {
                            var call = toolResult.ToolCalls[ti];
                            var capturedIndex = ti;

                            // §13.4 Tool guardrail (with rewrite support)
                            if (guardrails is not null)
                            {
                                var args = ToolDispatch.ParseArguments(call.Arguments);
                                var toolCheck = guardrails.CheckTool(call.Name, args);
                                if (!toolCheck.Allowed)
                                {
                                    var deniedMsg = $"Tool denied by guardrail: {toolCheck.Reason}";
                                    AgentEvents.EmitEvent(onEvent, AgentEventType.ToolResult,
                                        new Dictionary<string, object?> { ["tool"] = call.Name, ["result"] = deniedMsg });
                                    tasks.Add(Task.FromResult((capturedIndex, deniedMsg)));
                                    continue;
                                }
                                if (toolCheck.Rewrite is Dictionary<string, object?> rewrittenArgs)
                                {
                                    call.Arguments = System.Text.Json.JsonSerializer.Serialize(rewrittenArgs);
                                }
                            }

                            AgentEvents.EmitEvent(onEvent, AgentEventType.ToolCallStart,
                                new Dictionary<string, object?> { ["tool"] = call.Name, ["arguments"] = call.Arguments });

                            tasks.Add(Task.Run(async () =>
                            {
                                var toolResponse = await Trace.TraceAsync<string>("Prompty.Core.ToolDispatch.Execute", async (toolEmit) =>
                                {
                                    toolEmit("inputs", new Dictionary<string, object?> { ["tool"] = call.Name, ["arguments"] = call.Arguments });
                                    return await ToolDispatch.DispatchAsync(agent, call, tools);
                                });
                                return (capturedIndex, toolResponse);
                            }));
                        }

                        var completed = await Task.WhenAll(tasks);
                        // Maintain order
                        var ordered = new string[toolResult.ToolCalls.Count];
                        foreach (var (index, res) in completed)
                        {
                            ordered[index] = res;
                        }
                        toolResults.AddRange(ordered);

                        for (int ti = 0; ti < toolResult.ToolCalls.Count; ti++)
                        {
                            AgentEvents.EmitEvent(onEvent, AgentEventType.ToolResult,
                                new Dictionary<string, object?> { ["tool"] = toolResult.ToolCalls[ti].Name, ["result"] = toolResults[ti] });
                        }
                    }
                    else
                    {
                        // Sequential dispatch
                        foreach (var call in toolResult.ToolCalls)
                        {
                            // §13.4 Tool guardrail (with rewrite support)
                            if (guardrails is not null)
                            {
                                var args = ToolDispatch.ParseArguments(call.Arguments);
                                var toolCheck = guardrails.CheckTool(call.Name, args);
                                if (!toolCheck.Allowed)
                                {
                                    var deniedMsg = $"Tool denied by guardrail: {toolCheck.Reason}";
                                    AgentEvents.EmitEvent(onEvent, AgentEventType.ToolResult,
                                        new Dictionary<string, object?> { ["tool"] = call.Name, ["result"] = deniedMsg });
                                    toolResults.Add(deniedMsg);
                                    continue;
                                }
                                if (toolCheck.Rewrite is Dictionary<string, object?> rewrittenArgs)
                                {
                                    call.Arguments = System.Text.Json.JsonSerializer.Serialize(rewrittenArgs);
                                }
                            }

                            AgentEvents.EmitEvent(onEvent, AgentEventType.ToolCallStart,
                                new Dictionary<string, object?> { ["tool"] = call.Name, ["arguments"] = call.Arguments });

                            var toolResponse = await Trace.TraceAsync<string>("Prompty.Core.ToolDispatch.Execute", async (toolEmit) =>
                            {
                                toolEmit("inputs", new Dictionary<string, object?> { ["tool"] = call.Name, ["arguments"] = call.Arguments });
                                return await ToolDispatch.DispatchAsync(agent, call, tools);
                            });
                            toolResults.Add(toolResponse);

                            AgentEvents.EmitEvent(onEvent, AgentEventType.ToolResult,
                                new Dictionary<string, object?> { ["tool"] = call.Name, ["result"] = toolResponse });
                        }
                    }

                    // Delegate message formatting to the executor (provider-specific)
                    var toolMessages = executor.FormatToolMessages(
                        response, toolResult.ToolCalls, toolResults, toolResult.Content);
                    messages.AddRange(toolMessages);

                    AgentEvents.EmitEvent(onEvent, AgentEventType.MessagesUpdated,
                        new Dictionary<string, object?> { ["source"] = "tool_results", ["count"] = toolMessages.Count });

                    iteration++;
                    continue;
                }

                // §13.4 Output guardrail on final response
                if (guardrails is not null)
                {
                    var outputMsg = result switch
                    {
                        string resultText => new Message
                        {
                            Role = Roles.Assistant,
                            Parts = [new TextPart { Value = resultText }]
                        },
                        Message msg => msg,
                        _ => new Message
                        {
                            Role = Roles.Assistant,
                            Parts = [new TextPart { Value = result?.ToString() ?? "" }]
                        },
                    };
                    var outputCheck = guardrails.CheckOutput(outputMsg);
                    if (!outputCheck.Allowed)
                    {
                        AgentEvents.EmitEvent(onEvent, AgentEventType.Error,
                            new Dictionary<string, object?> { ["guardrail"] = "output", ["reason"] = outputCheck.Reason });
                        throw new GuardrailError(outputCheck.Reason ?? "Output guardrail denied");
                    }
                    if (outputCheck.Rewrite is not null)
                    {
                        result = outputCheck.Rewrite;
                    }
                }

                AgentEvents.EmitEvent(onEvent, AgentEventType.Done,
                    new Dictionary<string, object?> { ["iterations"] = iteration + 1 });

                return result!;
            }
        });
    }

    // -----------------------------------------------------------------------
    // Generic (typed) overloads
    // -----------------------------------------------------------------------

    /// <summary>
    /// Invoke a prompt and cast the result to a typed object.
    /// </summary>
    public static async Task<T> InvokeAsync<T>(Prompty agent, Dictionary<string, object?>? inputs = null)
    {
        var result = await InvokeAsync(agent, inputs);
        return PromptyCast.Cast<T>(result);
    }

    /// <summary>
    /// Invoke from a .prompty file path and cast the result to a typed object.
    /// </summary>
    public static async Task<T> InvokeAsync<T>(string path, Dictionary<string, object?>? inputs = null)
    {
        var result = await InvokeAsync(path, inputs);
        return PromptyCast.Cast<T>(result);
    }

    /// <summary>
    /// Run the agent loop and cast the result to a typed object.
    /// </summary>
    public static async Task<T> InvokeAgentAsync<T>(
        Prompty agent,
        Dictionary<string, object?>? inputs = null,
        Dictionary<string, Func<string, Task<string>>>? tools = null,
        int maxIterations = 10,
        bool raw = false,
        EventCallback? onEvent = null,
        CancellationToken cancellationToken = default,
        int? contextBudget = null,
        Guardrails? guardrails = null,
        Steering? steering = null,
        bool parallelToolCalls = false)
    {
        var result = await InvokeAgentAsync(agent, inputs, tools, maxIterations, raw, onEvent,
            cancellationToken, contextBudget, guardrails, steering, parallelToolCalls);
        return PromptyCast.Cast<T>(result);
    }

    // -----------------------------------------------------------------------
    // Thread Expansion
    // -----------------------------------------------------------------------

    /// <summary>
    /// Expands ThreadMarker placeholders in messages with actual conversation history
    /// from inputs. Thread-kind inputs are lists of Messages to splice in.
    /// </summary>
    internal static List<Message> ExpandThreadMarkers(
        List<Message> messages,
        Dictionary<string, object?> inputs)
    {
        var threadNonceRegex = new System.Text.RegularExpressions.Regex(
            @"__PROMPTY_THREAD_[a-f0-9]{8}_(\w+)__");

        var result = new List<Message>();

        foreach (var msg in messages)
        {
            var text = msg.Text;
            var match = threadNonceRegex.Match(text);

            if (!match.Success)
            {
                result.Add(msg);
                continue;
            }

            var inputName = match.Groups[1].Value;

            // Get thread messages from inputs
            if (!inputs.TryGetValue(inputName, out var threadValue) || threadValue is not IList<Message> threadMessages)
            {
                result.Add(msg);
                continue;
            }

            // Split text around the nonce
            var before = text[..match.Index].TrimEnd();
            var after = text[(match.Index + match.Length)..].TrimStart();

            // Add any text before the nonce as a message (if non-empty)
            if (!string.IsNullOrWhiteSpace(before))
            {
                result.Add(new Message
                {
                    Role = msg.Role,
                    Parts = [new TextPart { Value = before }],
                    Metadata = new Dictionary<string, object?>(msg.Metadata),
                });
            }

            // Splice in the thread messages
            result.AddRange(threadMessages);

            // Add any text after the nonce as a message (if non-empty)
            if (!string.IsNullOrWhiteSpace(after))
            {
                result.Add(new Message
                {
                    Role = msg.Role,
                    Parts = [new TextPart { Value = after }],
                    Metadata = new Dictionary<string, object?>(msg.Metadata),
                });
            }
        }

        return result;
    }
}

/// <summary>
/// Represents a tool call requested by the LLM.
/// </summary>
public class ToolCall
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Arguments { get; set; } = "";
}

/// <summary>
/// Result from a processor indicating the LLM wants to call tools.
/// Processors return this instead of a plain string when tool_calls are present.
/// </summary>
public class ToolCallResult
{
    public string? Content { get; set; }
    public List<ToolCall> ToolCalls { get; set; } = [];
}
