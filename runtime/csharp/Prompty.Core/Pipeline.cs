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
    public static async Task<List<Message>> ParseAsync(Prompty agent, string rendered, Dictionary<string, object?>? context)
    {
        return await Trace.TraceAsync<List<Message>>("Prompty.Core.Pipeline.ParseAsync", async (emit) =>
        {
            emit("inputs", new Dictionary<string, object?> { ["agent"] = agent.Name });
            var parserKind = agent.Template?.Parser?.Kind ?? "prompty";
            var parser = InvokerRegistry.GetParser(parserKind);
            return await parser.ParseAsync(agent, rendered, null);
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

            var messages = await parser.ParseAsync(agent, rendered, parserContext);
            messages = ExpandThreadMarkers(messages, validatedInputs);
            return messages;
        });
    }

    /// <summary>
    /// Execute + Process: send messages to LLM and post-process the response.
    /// Standalone building block with its own trace span.
    /// </summary>
    public static async Task<object> RunAsync(
        Prompty agent,
        List<Message> messages,
        bool raw = false)
    {
        return await Trace.TraceAsync<object>("prompty.run", async (emit) =>
        {
            emit("signature", "prompty.run");
            emit("inputs", new Dictionary<string, object?> { ["agent"] = agent.Name, ["message_count"] = messages.Count });
            var response = await ExecuteAsync(agent, messages);
            if (raw) return response;
            return await ProcessAsync(agent, response);
        });
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
    /// Full pipeline: Prepare → Execute → Process (directly, not via RunAsync).
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
            var response = await ExecuteAsync(agent, messages);
            if (raw) return response;
            return await ProcessAsync(agent, response);
        });
    }

    // -----------------------------------------------------------------------
    // Turn — conversational round-trip (prepare + [agent loop with tools] + process)
    // -----------------------------------------------------------------------

    /// <summary>
    /// Conversational round-trip through the canonical durable turn engine.
    /// If no tools are provided, the engine performs a single Prepare → Execute → Process pass.
    /// </summary>
    /// <remarks>
    /// Cancellation is cooperative at engine phase boundaries. The current generated provider and
    /// tool protocols do not expose a native <see cref="CancellationToken"/>, so an in-flight
    /// non-streaming provider or tool call may finish before cancellation is observed.
    /// </remarks>
    public static async Task<object> TurnAsync(
        Prompty agent,
        Dictionary<string, object?>? inputs = null,
        Dictionary<string, Func<string, Task<string>>>? tools = null,
        int maxIterations = 10,
        bool raw = false,
        int? turnNumber = null,
        EventCallback? onEvent = null,
        CancellationToken cancellationToken = default,
        int? contextBudget = null,
        Guardrails? guardrails = null,
        Steering? steering = null,
        bool parallelToolCalls = false,
        int maxLlmRetries = 3,
        CompactionStrategy? compaction = null)
    {
        var label = turnNumber.HasValue ? $"turn {turnNumber.Value}" : "turn";
        return await Trace.TraceAsync<object>("prompty.turn", async (emit) =>
        {
            emit("signature", "prompty.turn");
            emit("inputs", new Dictionary<string, object?>
            {
                ["agent"] = agent.Name,
                ["label"] = label,
                ["maxIterations"] = maxIterations,
            });
            return await LiveTurn.RunAsync(
                agent,
                inputs,
                tools,
                maxIterations,
                raw,
                onEvent,
                cancellationToken,
                contextBudget,
                guardrails,
                steering,
                parallelToolCalls,
                maxLlmRetries,
                compaction).ConfigureAwait(false);
        }).ConfigureAwait(false);

    }

    /// <summary>
    /// Executes or resumes a turn through the canonical engine using caller-owned durability and effect ports.
    /// </summary>
    /// <remarks>
    /// Runtime-local effect ports receive the native token. Adapters over generated protocols remain
    /// boundary-cancellable until the schema/emitter supports language-native cancellation seams.
    /// </remarks>
    public static Task<object> TurnWithEngineRequestAsync(
        Prompty agent,
        TurnEngineRequest request,
        TurnEnginePipelineOptions? options = null,
        CancellationToken cancellationToken = default)
        => LiveTurn.RunAsync(agent, request, options, cancellationToken);

    /// <summary>
    /// Conversational round-trip with path-based loading.
    /// </summary>
    public static async Task<object> TurnAsync(
        string path,
        Dictionary<string, object?>? inputs = null,
        Dictionary<string, Func<string, Task<string>>>? tools = null,
        int maxIterations = 10,
        bool raw = false,
        int? turnNumber = null,
        EventCallback? onEvent = null,
        CancellationToken cancellationToken = default,
        int? contextBudget = null,
        Guardrails? guardrails = null,
        Steering? steering = null,
        bool parallelToolCalls = false,
        int maxLlmRetries = 3,
        CompactionStrategy? compaction = null)
    {
        var agent = PromptyLoader.Load(path);
        return await TurnAsync(agent, inputs, tools, maxIterations, raw, turnNumber, onEvent,
            cancellationToken, contextBudget, guardrails, steering, parallelToolCalls, maxLlmRetries, compaction);
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
    /// Conversational round-trip and cast the result to a typed object.
    /// </summary>
    public static async Task<T> TurnAsync<T>(
        Prompty agent,
        Dictionary<string, object?>? inputs = null,
        Dictionary<string, Func<string, Task<string>>>? tools = null,
        int maxIterations = 10,
        bool raw = false,
        int? turnNumber = null,
        EventCallback? onEvent = null,
        CancellationToken cancellationToken = default,
        int? contextBudget = null,
        Guardrails? guardrails = null,
        Steering? steering = null,
        bool parallelToolCalls = false,
        int maxLlmRetries = 3,
        CompactionStrategy? compaction = null)
    {
        var result = await TurnAsync(agent, inputs, tools, maxIterations, raw, turnNumber, onEvent,
            cancellationToken, contextBudget, guardrails, steering, parallelToolCalls, maxLlmRetries, compaction);
        return PromptyCast.Cast<T>(result);
    }

    /// <summary>
    /// Conversational round-trip from a .prompty file path and cast the result to a typed object.
    /// </summary>
    public static async Task<T> TurnAsync<T>(
        string path,
        Dictionary<string, object?>? inputs = null,
        Dictionary<string, Func<string, Task<string>>>? tools = null,
        int maxIterations = 10,
        bool raw = false,
        int? turnNumber = null,
        EventCallback? onEvent = null,
        CancellationToken cancellationToken = default,
        int? contextBudget = null,
        Guardrails? guardrails = null,
        Steering? steering = null,
        bool parallelToolCalls = false,
        int maxLlmRetries = 3,
        CompactionStrategy? compaction = null)
    {
        var result = await TurnAsync(path, inputs, tools, maxIterations, raw, turnNumber, onEvent,
            cancellationToken, contextBudget, guardrails, steering, parallelToolCalls, maxLlmRetries, compaction);
        return PromptyCast.Cast<T>(result);
    }

    // -----------------------------------------------------------------------
    // Compaction Helper
    // -----------------------------------------------------------------------

    /// <summary>
    /// Apply a compaction strategy to replace the default dropped-message summary.
    /// On failure, the existing SummarizeDropped summary is preserved.
    /// </summary>
    internal static async Task ApplyCompactionAsync(
        CompactionStrategy compaction,
        List<Message> dropped,
        List<Message> messages,
        EventCallback? onEvent)
    {
        AgentEvents.EmitEvent(onEvent, AgentEventType.CompactionStart,
            new Dictionary<string, object?> { ["dropped_count"] = dropped.Count });
        try
        {
            var summary = await compaction.CompactAsync(dropped);
            if (!string.IsNullOrWhiteSpace(summary))
            {
                ReplaceSummaryMessage(messages, summary);
                AgentEvents.EmitEvent(onEvent, AgentEventType.CompactionComplete,
                    new Dictionary<string, object?> { ["summary_length"] = summary.Length });
            }
            else
            {
                AgentEvents.EmitEvent(onEvent, AgentEventType.CompactionFailed,
                    new Dictionary<string, object?> { ["reason"] = "empty result" });
            }
        }
        catch (Exception ex)
        {
            AgentEvents.EmitEvent(onEvent, AgentEventType.CompactionFailed,
                new Dictionary<string, object?> { ["reason"] = ex.Message });
        }
    }

    /// <summary>
    /// Replace the first "[Context summary:" message with a compaction-produced summary.
    /// </summary>
    internal static void ReplaceSummaryMessage(List<Message> messages, string newSummary)
    {
        for (int i = 0; i < messages.Count; i++)
        {
            if (messages[i].Text.StartsWith("[Context summary:"))
            {
                messages[i] = new Message
                {
                    Role = messages[i].Role,
                    Parts = [new TextPart { Value = newSummary }]
                };
                return;
            }
        }
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
                    Metadata = msg.Metadata is not null ? new Dictionary<string, object>(msg.Metadata) : new Dictionary<string, object>(),
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
                    Metadata = msg.Metadata is not null ? new Dictionary<string, object>(msg.Metadata) : new Dictionary<string, object>(),
                });
            }
        }

        return result;
    }
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

/// <summary>
/// Error from agent loop that includes accumulated conversation state (§9.10).
/// </summary>
public class ExecuteError : Exception
{
    public List<Message> Messages { get; }

    public ExecuteError(string message, List<Message> messages)
        : base(message)
    {
        Messages = messages;
    }
}
