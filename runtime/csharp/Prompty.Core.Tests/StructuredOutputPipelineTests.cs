// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Core.Tests;

/// <summary>
/// Tests that structured output flows correctly through the top-level pipeline
/// entry points (InvokeAsync, RunAsync, InvokeAsync&lt;T&gt;) with mocked providers.
/// Guards against the class of bug where invoke() returns the raw wrapper instead
/// of unwrapped clean data.
/// </summary>
[Collection("InvokerRegistry")]
public class StructuredOutputPipelineTests : IDisposable
{
    private const string StructuredJson = """{"temperature":72.5,"unit":"F","city":"Seattle"}""";

    public StructuredOutputPipelineTests()
    {
        InvokerRegistry.Clear();
        InvokerRegistry.RegisterRenderer("jinja2", new PassthroughRenderer());
        InvokerRegistry.RegisterParser("prompty", new SingleMessageParser());
    }

    public void Dispose()
    {
        InvokerRegistry.Clear();
    }

    // -----------------------------------------------------------------------
    // InvokeAsync — returns StructuredResult (clean data, not raw LLM wrapper)
    // -----------------------------------------------------------------------

    [Fact]
    public async Task InvokeAsync_WithStructuredOutput_ReturnsStructuredResult()
    {
        InvokerRegistry.RegisterExecutor("openai", new RawJsonExecutor(StructuredJson));
        InvokerRegistry.RegisterProcessor("openai", new StructuredOutputProcessor());

        var agent = CreateAgentWithOutputs();
        var result = await Pipeline.InvokeAsync(agent);

        Assert.IsType<StructuredResult>(result);
        var sr = (StructuredResult)result;
        Assert.Equal(72.5, sr["temperature"]);
        Assert.Equal("F", sr["unit"]);
        Assert.Equal("Seattle", sr["city"]);
    }

    [Fact]
    public async Task InvokeAsync_WithStructuredOutput_PreservesRawJson()
    {
        InvokerRegistry.RegisterExecutor("openai", new RawJsonExecutor(StructuredJson));
        InvokerRegistry.RegisterProcessor("openai", new StructuredOutputProcessor());

        var agent = CreateAgentWithOutputs();
        var result = await Pipeline.InvokeAsync(agent);

        var sr = Assert.IsType<StructuredResult>(result);
        Assert.Equal(StructuredJson, sr.RawJson);
    }

    [Fact]
    public async Task InvokeAsync_WithStructuredOutput_ResultIsDictionary()
    {
        InvokerRegistry.RegisterExecutor("openai", new RawJsonExecutor(StructuredJson));
        InvokerRegistry.RegisterProcessor("openai", new StructuredOutputProcessor());

        var agent = CreateAgentWithOutputs();
        var result = await Pipeline.InvokeAsync(agent);

        // StructuredResult inherits from Dictionary — callers can use it as a dict
        Assert.IsAssignableFrom<IDictionary<string, object?>>(result);
    }

    // -----------------------------------------------------------------------
    // RunAsync — execute + process path
    // -----------------------------------------------------------------------

    [Fact]
    public async Task RunAsync_WithStructuredOutput_ReturnsCleanData()
    {
        InvokerRegistry.RegisterExecutor("openai", new RawJsonExecutor(StructuredJson));
        InvokerRegistry.RegisterProcessor("openai", new StructuredOutputProcessor());

        var agent = CreateAgentWithOutputs();
        var messages = new List<Message>
        {
            new() { Role = Roles.User, Parts = [new TextPart { Value = "What is the weather?" }] }
        };

        var result = await Pipeline.RunAsync(agent, messages);

        var sr = Assert.IsType<StructuredResult>(result);
        Assert.Equal("Seattle", sr["city"]);
        Assert.Equal(72.5, sr["temperature"]);
    }

    [Fact]
    public async Task RunAsync_Raw_ReturnsUnprocessedResponse()
    {
        InvokerRegistry.RegisterExecutor("openai", new RawJsonExecutor(StructuredJson));
        InvokerRegistry.RegisterProcessor("openai", new StructuredOutputProcessor());

        var agent = CreateAgentWithOutputs();
        var messages = new List<Message>
        {
            new() { Role = Roles.User, Parts = [new TextPart { Value = "What is the weather?" }] }
        };

        var result = await Pipeline.RunAsync(agent, messages, raw: true);

        // raw: true skips ProcessAsync — we get the executor's raw return value
        Assert.IsType<string>(result);
        Assert.Equal(StructuredJson, result);
    }

    // -----------------------------------------------------------------------
    // InvokeAsync<T> — generic typed deserialization
    // -----------------------------------------------------------------------

    public record WeatherData(double Temperature, string Unit, string City);

    [Fact]
    public async Task InvokeAsyncGeneric_WithStructuredOutput_DeserializesCorrectly()
    {
        InvokerRegistry.RegisterExecutor("openai", new RawJsonExecutor(StructuredJson));
        InvokerRegistry.RegisterProcessor("openai", new StructuredOutputProcessor());

        var agent = CreateAgentWithOutputs();
        var weather = await Pipeline.InvokeAsync<WeatherData>(agent);

        Assert.Equal(72.5, weather.Temperature);
        Assert.Equal("F", weather.Unit);
        Assert.Equal("Seattle", weather.City);
    }

    [Fact]
    public async Task InvokeAsyncGeneric_WithNestedStructuredOutput_DeserializesCorrectly()
    {
        var nestedJson = """{"location":{"city":"Portland","state":"OR"},"temp":65.0}""";
        InvokerRegistry.RegisterExecutor("openai", new RawJsonExecutor(nestedJson));
        InvokerRegistry.RegisterProcessor("openai", new StructuredOutputProcessor());

        var agent = CreateAgentWithOutputs();
        var result = await Pipeline.InvokeAsync<NestedWeather>(agent);

        Assert.NotNull(result.Location);
        Assert.Equal("Portland", result.Location.City);
        Assert.Equal("OR", result.Location.State);
        Assert.Equal(65.0, result.Temp);
    }

    public record LocationInfo(string City, string State);
    public record NestedWeather(LocationInfo Location, double Temp);

    // -----------------------------------------------------------------------
    // Array structured output
    // -----------------------------------------------------------------------

    [Fact]
    public async Task InvokeAsync_WithArrayStructuredOutput_ReturnsStructuredResult()
    {
        var arrayJson = """{"items":["rain","snow","sun"],"count":3}""";
        InvokerRegistry.RegisterExecutor("openai", new RawJsonExecutor(arrayJson));
        InvokerRegistry.RegisterProcessor("openai", new StructuredOutputProcessor());

        var agent = CreateAgentWithOutputs();
        var result = await Pipeline.InvokeAsync(agent);

        var sr = Assert.IsType<StructuredResult>(result);
        var items = sr["items"] as List<object?>;
        Assert.NotNull(items);
        Assert.Equal(3, items!.Count);
        Assert.Equal(3L, sr["count"]);
    }

    // -----------------------------------------------------------------------
    // Without output schema — processor returns plain string (no wrapping)
    // -----------------------------------------------------------------------

    [Fact]
    public async Task InvokeAsync_WithoutOutputSchema_ReturnsPlainString()
    {
        InvokerRegistry.RegisterExecutor("openai", new RawJsonExecutor("plain text response"));
        InvokerRegistry.RegisterProcessor("openai", new PlainProcessor());

        var agent = CreateAgent(); // No outputs defined
        var result = await Pipeline.InvokeAsync(agent);

        Assert.IsType<string>(result);
        Assert.Equal("processed:plain text response", result);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private static Prompty CreateAgent(string provider = "openai")
    {
        var data = new Dictionary<string, object?>
        {
            ["name"] = "structured-test",
            ["instructions"] = "You are a weather bot.",
            ["model"] = new Dictionary<string, object?>
            {
                ["id"] = "gpt-4",
                ["provider"] = provider,
            },
            ["template"] = new Dictionary<string, object?>
            {
                ["format"] = new Dictionary<string, object?> { ["kind"] = "jinja2" },
                ["parser"] = new Dictionary<string, object?> { ["kind"] = "prompty" },
            },
        };
        return Prompty.Load(data, new LoadContext());
    }

    private static Prompty CreateAgentWithOutputs()
    {
        var agent = CreateAgent();
        agent.Outputs =
        [
            new Property { Name = "temperature", Kind = "float", Description = "Temperature value" },
            new Property { Name = "unit", Kind = "string", Description = "Temperature unit" },
            new Property { Name = "city", Kind = "string", Description = "City name" },
        ];
        return agent;
    }
}

// -----------------------------------------------------------------------
// Mock implementations for structured output tests
// -----------------------------------------------------------------------

/// <summary>
/// Renderer that passes through the template unchanged.
/// </summary>
internal class PassthroughRenderer : IRenderer
{
    public Task<string> RenderAsync(Prompty agent, string template, Dictionary<string, object?> inputs)
        => Task.FromResult(template);
}

/// <summary>
/// Parser that wraps any rendered text into a single user message.
/// </summary>
internal class SingleMessageParser : IParser
{
    public Task<List<Message>> ParseAsync(Prompty agent, string rendered)
        => Task.FromResult<List<Message>>(
            [new Message { Role = Roles.User, Parts = [new TextPart { Value = rendered }] }]);
}

/// <summary>
/// Executor that returns a raw JSON string (simulating an LLM structured output response).
/// </summary>
internal class RawJsonExecutor : IExecutor
{
    private readonly string _rawJson;

    public RawJsonExecutor(string rawJson) => _rawJson = rawJson;

    public Task<object> ExecuteAsync(Prompty agent, List<Message> messages)
        => Task.FromResult<object>(_rawJson);

    public List<Message> FormatToolMessages(object rawResponse, List<ToolCall> toolCalls, List<ToolResult> toolResults, string? textContent = null)
        => [];
}

/// <summary>
/// Processor that converts raw JSON into a StructuredResult (the real OpenAI processor
/// does this when outputSchema is present). This is the critical path we're testing:
/// the pipeline must return the StructuredResult, not wrap or stringify it.
/// </summary>
internal class StructuredOutputProcessor : IProcessor
{
    public Task<object> ProcessAsync(Prompty agent, object response)
    {
        var json = response as string ?? throw new InvalidOperationException("Expected string response");
        return Task.FromResult<object>(StructuredResult.FromJson(json));
    }
}

/// <summary>
/// Processor that returns a plain processed string (no structured output).
/// </summary>
internal class PlainProcessor : IProcessor
{
    public Task<object> ProcessAsync(Prompty agent, object response)
        => Task.FromResult<object>($"processed:{response}");
}


