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
    /// or maxIterations is reached.
    /// </summary>
    public static async Task<object> InvokeAgentAsync(
        Prompty agent,
        Dictionary<string, object?>? inputs = null,
        Dictionary<string, Func<string, Task<string>>>? tools = null,
        int maxIterations = 10,
        bool raw = false)
    {
        return await Trace.TraceAsync<object>("Prompty.Core.Pipeline.InvokeAgentAsync", async (emit) =>
        {
            emit("inputs", new Dictionary<string, object?> { ["agent"] = agent.Name, ["maxIterations"] = maxIterations });
            var messages = await PrepareAsync(agent, inputs);

            for (var i = 0; i < maxIterations; i++)
            {
                var response = await ExecuteAsync(agent, messages);
                var result = raw ? response : await ProcessAsync(agent, response);

                if (result is ToolCallResult toolResult && toolResult.ToolCalls.Count > 0)
                {
                    var assistantMsg = new Message
                    {
                        Role = Roles.Assistant,
                        Parts = string.IsNullOrEmpty(toolResult.Content)
                            ? []
                            : [new TextPart { Value = toolResult.Content }],
                        Metadata = new Dictionary<string, object?> { ["tool_calls"] = toolResult.ToolCalls },
                    };
                    messages.Add(assistantMsg);

                    foreach (var call in toolResult.ToolCalls)
                    {
                        var toolResponse = await Trace.TraceAsync<string>("Prompty.Core.ToolDispatch.Execute", async (toolEmit) =>
                        {
                            toolEmit("inputs", new Dictionary<string, object?> { ["tool"] = call.Name, ["arguments"] = call.Arguments });
                            return await ToolDispatch.DispatchAsync(agent, call, tools);
                        });

                        messages.Add(new Message
                        {
                            Role = Roles.Tool,
                            Parts = [new TextPart { Value = toolResponse }],
                            Metadata = new Dictionary<string, object?>
                            {
                                ["tool_call_id"] = call.Id,
                                ["name"] = call.Name,
                            },
                        });
                    }

                    continue;
                }

                return result;
            }

            throw new InvalidOperationException(
                $"Agent loop exceeded maximum iterations ({maxIterations}).");
        });
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
        // For now, scan message text for thread nonce patterns and expand them.
        // Full nonce-based expansion will be implemented with renderers in Phase 3.
        // This is a passthrough until then.
        return messages;
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
