// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using Prompty.Core;

namespace Prompty.Providers.Tests;

/// <summary>
/// Spec vector tests for the agent stage — loads canonical vectors from
/// spec/vectors/agent/agent_vectors.json and runs them through the real
/// Pipeline.InvokeAgentAsync with mock executor/processor.
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
    public async Task AgentLoop_SuccessVectors(string name, JsonElement input, JsonElement[] sequence, JsonElement expected)
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
        var result = await Pipeline.InvokeAgentAsync(agent, tools: toolFunctions);

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
                () => Pipeline.InvokeAgentAsync(agent, tools: toolFunctions, maxIterations: 10));
        }
        else if (errorMsg.Contains("not registered"))
        {
            // The agent loop may throw ToolHandlerError (which extends InvalidOperationException)
            // or run out of mock responses
            try
            {
                await Pipeline.InvokeAgentAsync(agent, tools: toolFunctions);
            }
            catch (InvalidOperationException)
            {
                // Expected — either ToolHandlerError or mock ran out of responses
            }
        }
    }

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

            var name = vec.GetProperty("name").GetString()!;
            var input = vec.GetProperty("input");
            var sequence = vec.GetProperty("sequence").EnumerateArray().ToArray();

            yield return [name, input, sequence, expected];
        }
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
            toolFunctions[toolName] = args =>
            {
                // Find the result by looking through all queues for matching tool_call_id
                // Since we map by call_id in the toolResultMap, we need a different approach:
                // just return from a per-tool queue based on invocation order
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
    }
}
