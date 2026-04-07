// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Core.Tests;

// -----------------------------------------------------------------------
// Types Tests
// -----------------------------------------------------------------------

public class MessageTests
{
    [Fact]
    public void Text_ConcatenatesAllTextParts()
    {
        var msg = new Message
        {
            Role = Roles.User,
            Parts = [new TextPart { Value = "Hello " }, new TextPart { Value = "World" }]
        };
        Assert.Equal("Hello World", msg.Text);
    }

    [Fact]
    public void Text_IgnoresNonTextParts()
    {
        var msg = new Message
        {
            Parts = [
                new TextPart { Value = "Hello" },
                new ImagePart { Source = "img.png" },
                new TextPart { Value = " there" },
            ]
        };
        Assert.Equal("Hello there", msg.Text);
    }

    [Fact]
    public void Text_EmptyWhenNoParts()
    {
        Assert.Equal("", new Message().Text);
    }

    [Fact]
    public void ToTextContent_ReturnsStringWhenAllText()
    {
        var msg = new Message { Parts = [new TextPart { Value = "Hi" }] };
        Assert.IsType<string>(msg.ToTextContent());
        Assert.Equal("Hi", msg.ToTextContent());
    }

    [Fact]
    public void ToTextContent_ReturnsListWhenMultimodal()
    {
        var msg = new Message
        {
            Parts = [
                new TextPart { Value = "Look at this" },
                new ImagePart { Source = "http://img.png", Detail = "high" },
            ]
        };
        var content = msg.ToTextContent();
        var list = Assert.IsType<List<Dictionary<string, object?>>>(content);
        Assert.Equal(2, list.Count);
        Assert.Equal("text", list[0]["type"]);
        Assert.Equal("image_url", list[1]["type"]);
    }

    [Fact]
    public void DefaultRole_IsUser()
    {
        Assert.Equal(Roles.User, new Message().Role);
    }
}

public class ContentPartTests
{
    [Fact]
    public void TextPart_Kind_IsText()
    {
        Assert.Equal("text", new TextPart().Kind);
    }

    [Fact]
    public void ImagePart_Kind_IsImage()
    {
        Assert.Equal("image", new ImagePart().Kind);
    }

    [Fact]
    public void FilePart_Kind_IsFile()
    {
        Assert.Equal("file", new FilePart().Kind);
    }

    [Fact]
    public void AudioPart_Kind_IsAudio()
    {
        Assert.Equal("audio", new AudioPart().Kind);
    }
}

public class RolesTests
{
    [Theory]
    [InlineData("system")]
    [InlineData("user")]
    [InlineData("assistant")]
    [InlineData("developer")]
    [InlineData("tool")]
    public void AllRoles_AreInSet(string role)
    {
        Assert.Contains(role, Roles.All);
    }
}

// -----------------------------------------------------------------------
// InvokerRegistry Tests
// -----------------------------------------------------------------------

[Collection("InvokerRegistry")]
public class InvokerRegistryTests : IDisposable
{
    public InvokerRegistryTests()
    {
        InvokerRegistry.Clear();
    }

    public void Dispose()
    {
        InvokerRegistry.Clear();
    }

    [Fact]
    public void RegisterAndGet_Renderer()
    {
        var mock = new MockRenderer();
        InvokerRegistry.RegisterRenderer("test", mock);
        Assert.Same(mock, InvokerRegistry.GetRenderer("test"));
    }

    [Fact]
    public void RegisterAndGet_Parser()
    {
        var mock = new MockParser();
        InvokerRegistry.RegisterParser("test", mock);
        Assert.Same(mock, InvokerRegistry.GetParser("test"));
    }

    [Fact]
    public void RegisterAndGet_Executor()
    {
        var mock = new MockExecutor();
        InvokerRegistry.RegisterExecutor("test", mock);
        Assert.Same(mock, InvokerRegistry.GetExecutor("test"));
    }

    [Fact]
    public void RegisterAndGet_Processor()
    {
        var mock = new MockProcessor();
        InvokerRegistry.RegisterProcessor("test", mock);
        Assert.Same(mock, InvokerRegistry.GetProcessor("test"));
    }

    [Fact]
    public void GetRenderer_ThrowsInvokerError_WhenMissing()
    {
        var ex = Assert.Throws<InvokerError>(() => InvokerRegistry.GetRenderer("nope"));
        Assert.Equal("renderer", ex.Group);
        Assert.Equal("nope", ex.Key);
        Assert.Contains("Register", ex.Message);
    }

    [Fact]
    public void GetParser_ThrowsInvokerError_WhenMissing()
    {
        var ex = Assert.Throws<InvokerError>(() => InvokerRegistry.GetParser("nope"));
        Assert.Equal("parser", ex.Group);
    }

    [Fact]
    public void GetExecutor_ThrowsInvokerError_WhenMissing()
    {
        var ex = Assert.Throws<InvokerError>(() => InvokerRegistry.GetExecutor("nope"));
        Assert.Equal("executor", ex.Group);
    }

    [Fact]
    public void GetProcessor_ThrowsInvokerError_WhenMissing()
    {
        var ex = Assert.Throws<InvokerError>(() => InvokerRegistry.GetProcessor("nope"));
        Assert.Equal("processor", ex.Group);
    }

    [Fact]
    public void HasRenderer_ReturnsTrueWhenRegistered()
    {
        InvokerRegistry.RegisterRenderer("x", new MockRenderer());
        Assert.True(InvokerRegistry.HasRenderer("x"));
        Assert.False(InvokerRegistry.HasRenderer("y"));
    }

    [Fact]
    public void LookupIsCaseInsensitive()
    {
        InvokerRegistry.RegisterRenderer("Jinja2", new MockRenderer());
        Assert.True(InvokerRegistry.HasRenderer("jinja2"));
        Assert.True(InvokerRegistry.HasRenderer("JINJA2"));
    }

    [Fact]
    public void RegisterOverwrites_PreviousEntry()
    {
        var first = new MockRenderer();
        var second = new MockRenderer();
        InvokerRegistry.RegisterRenderer("x", first);
        InvokerRegistry.RegisterRenderer("x", second);
        Assert.Same(second, InvokerRegistry.GetRenderer("x"));
    }

    [Fact]
    public void Clear_RemovesAll()
    {
        InvokerRegistry.RegisterRenderer("a", new MockRenderer());
        InvokerRegistry.RegisterParser("b", new MockParser());
        InvokerRegistry.RegisterExecutor("c", new MockExecutor());
        InvokerRegistry.RegisterProcessor("d", new MockProcessor());

        InvokerRegistry.Clear();

        Assert.False(InvokerRegistry.HasRenderer("a"));
        Assert.False(InvokerRegistry.HasParser("b"));
        Assert.False(InvokerRegistry.HasExecutor("c"));
        Assert.False(InvokerRegistry.HasProcessor("d"));
    }
}

// -----------------------------------------------------------------------
// Pipeline Tests
// -----------------------------------------------------------------------

[Collection("InvokerRegistry")]
public class PipelineTests : IDisposable
{
    public PipelineTests()
    {
        InvokerRegistry.Clear();
        // Register mocks
        InvokerRegistry.RegisterRenderer("jinja2", new MockRenderer());
        InvokerRegistry.RegisterParser("prompty", new MockParser());
        InvokerRegistry.RegisterExecutor("openai", new MockExecutor());
        InvokerRegistry.RegisterProcessor("openai", new MockProcessor());
    }

    public void Dispose()
    {
        InvokerRegistry.Clear();
    }

    // --- ValidateInputs ---

    [Fact]
    public void ValidateInputs_ReturnsEmptyDict_WhenNoSchema()
    {
        var agent = CreateAgent();
        var result = Pipeline.ValidateInputs(agent, null);
        Assert.Empty(result);
    }

    [Fact]
    public void ValidateInputs_PassthroughInputs_WhenPresent()
    {
        var agent = CreateAgent();
        var inputs = new Dictionary<string, object?> { ["name"] = "Jane" };
        var result = Pipeline.ValidateInputs(agent, inputs);
        Assert.Equal("Jane", result["name"]);
    }

    [Fact]
    public void ValidateInputs_FillsDefaults()
    {
        var agent = CreateAgentWithInputs(new Property { Name = "city", Default = "Seattle" });
        var result = Pipeline.ValidateInputs(agent, null);
        Assert.Equal("Seattle", result["city"]);
    }

    [Fact]
    public void ValidateInputs_FillsExamples_WhenNoDefault()
    {
        var agent = CreateAgentWithInputs(new Property { Name = "city", Example = "Portland" });
        var result = Pipeline.ValidateInputs(agent, null);
        Assert.Equal("Portland", result["city"]);
    }

    [Fact]
    public void ValidateInputs_ThrowsForRequiredMissing()
    {
        var agent = CreateAgentWithInputs(new Property { Name = "city", Required = true });
        Assert.Throws<ArgumentException>(() => Pipeline.ValidateInputs(agent, null));
    }

    [Fact]
    public void ValidateInputs_DoesNotOverrideProvidedInput()
    {
        var agent = CreateAgentWithInputs(new Property { Name = "city", Default = "Seattle" });
        var inputs = new Dictionary<string, object?> { ["city"] = "Portland" };
        var result = Pipeline.ValidateInputs(agent, inputs);
        Assert.Equal("Portland", result["city"]);
    }

    // --- Pipeline Steps ---

    [Fact]
    public async Task RenderAsync_UsesFormatKind()
    {
        var agent = CreateAgent();
        var result = await Pipeline.RenderAsync(agent, new Dictionary<string, object?> { ["name"] = "Jane" });
        Assert.Contains("rendered", result); // MockRenderer returns "rendered:{template}"
    }

    [Fact]
    public async Task ParseAsync_UsesParserKind()
    {
        var agent = CreateAgent();
        var messages = await Pipeline.ParseAsync(agent, "system:\nHello");
        Assert.Single(messages); // MockParser returns 1 message
    }

    [Fact]
    public async Task ExecuteAsync_UsesProvider()
    {
        var agent = CreateAgent();
        var response = await Pipeline.ExecuteAsync(agent, [new Message { Parts = [new TextPart { Value = "Hi" }] }]);
        Assert.Equal("mock-response", response);
    }

    [Fact]
    public async Task ProcessAsync_UsesProvider()
    {
        var agent = CreateAgent();
        var result = await Pipeline.ProcessAsync(agent, "raw-response");
        Assert.Equal("processed:raw-response", result);
    }

    // --- Composed Operations ---

    [Fact]
    public async Task PrepareAsync_Renders_Then_Parses()
    {
        var agent = CreateAgent();
        var messages = await Pipeline.PrepareAsync(agent, new Dictionary<string, object?> { ["name"] = "Jane" });
        Assert.Single(messages);
    }

    [Fact]
    public async Task RunAsync_Executes_Then_Processes()
    {
        var agent = CreateAgent();
        var result = await Pipeline.RunAsync(agent, [new Message { Parts = [new TextPart { Value = "Hi" }] }]);
        Assert.Equal("processed:mock-response", result);
    }

    [Fact]
    public async Task RunAsync_ReturnsRawResponse_WhenRawIsTrue()
    {
        var agent = CreateAgent();
        var result = await Pipeline.RunAsync(agent, [new Message()], raw: true);
        Assert.Equal("mock-response", result);
    }

    [Fact]
    public async Task InvokeAsync_FullPipeline()
    {
        var agent = CreateAgent();
        var result = await Pipeline.InvokeAsync(agent);
        Assert.Equal("processed:mock-response", result);
    }

    // --- Agent Loop ---

    [Fact]
    public async Task InvokeAgentAsync_NoToolCalls_ReturnsFinalResult()
    {
        var agent = CreateAgent();
        var result = await Pipeline.InvokeAgentAsync(agent);
        Assert.Equal("processed:mock-response", result);
    }

    [Fact]
    public async Task InvokeAgentAsync_WithToolCalls_ExecutesTools()
    {
        // Use a special executor that returns tool calls first, then a final answer
        InvokerRegistry.RegisterExecutor("openai", new ToolCallingExecutor());
        InvokerRegistry.RegisterProcessor("openai", new ToolCallingProcessor());

        var agent = CreateAgent();
        var tools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["get_weather"] = args => Task.FromResult("72°F and sunny")
        };

        var result = await Pipeline.InvokeAgentAsync(agent, tools: tools);
        Assert.Equal("The weather is 72°F and sunny", result);
    }

    [Fact]
    public async Task InvokeAgentAsync_MissingTool_Throws()
    {
        InvokerRegistry.RegisterExecutor("openai", new ToolCallingExecutor());
        InvokerRegistry.RegisterProcessor("openai", new ToolCallingProcessor());

        var agent = CreateAgent();
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => Pipeline.InvokeAgentAsync(agent));
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private static Prompty CreateAgent(string provider = "openai")
    {
        var data = new Dictionary<string, object?>
        {
            ["kind"] = "prompt",
            ["name"] = "test",
            ["instructions"] = "Hello {{name}}",
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

    private static Prompty CreateAgentWithInputs(params Property[] props)
    {
        var agent = CreateAgent();
        agent.Inputs = [.. props];
        return agent;
    }
}

// -----------------------------------------------------------------------
// Mock Implementations
// -----------------------------------------------------------------------

internal class MockRenderer : IRenderer
{
    public Task<string> RenderAsync(Prompty agent, string template, Dictionary<string, object?> inputs)
        => Task.FromResult($"rendered:{template}");
}

internal class MockParser : IParser
{
    public Task<List<Message>> ParseAsync(Prompty agent, string rendered)
        => Task.FromResult<List<Message>>([new Message { Role = Roles.System, Parts = [new TextPart { Value = rendered }] }]);
}

internal class MockExecutor : IExecutor
{
    public Task<object> ExecuteAsync(Prompty agent, List<Message> messages)
        => Task.FromResult<object>("mock-response");
}

internal class MockProcessor : IProcessor
{
    public Task<object> ProcessAsync(Prompty agent, object response)
        => Task.FromResult<object>($"processed:{response}");
}

/// <summary>
/// Executor that returns tool calls on first invocation, then a final answer.
/// </summary>
internal class ToolCallingExecutor : IExecutor
{
    private int _callCount;

    public Task<object> ExecuteAsync(Prompty agent, List<Message> messages)
    {
        _callCount++;
        if (_callCount == 1)
        {
            return Task.FromResult<object>("tool_calls_response");
        }
        return Task.FromResult<object>("final_response");
    }
}

/// <summary>
/// Processor that returns ToolCallResult on first call, then a string.
/// </summary>
internal class ToolCallingProcessor : IProcessor
{
    private int _callCount;

    public Task<object> ProcessAsync(Prompty agent, object response)
    {
        _callCount++;
        if (response is string s && s == "tool_calls_response")
        {
            return Task.FromResult<object>(new ToolCallResult
            {
                ToolCalls =
                [
                    new ToolCall { Id = "call_1", Name = "get_weather", Arguments = """{"city":"Seattle"}""" }
                ]
            });
        }
        return Task.FromResult<object>("The weather is 72°F and sunny");
    }
}
