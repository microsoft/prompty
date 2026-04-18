// Copyright (c) Microsoft. All rights reserved.

using NSubstitute;
using Prompty.Core;
using Prompty.OpenAI;
using Xunit;

namespace DocsExamples.Tests;

/// <summary>
/// Tests for the ChatBasic example, verifying the pipeline works correctly
/// with mocked executor and processor.
/// </summary>
[Collection("DocsExamples")]
public class ChatTests : IDisposable
{
    /// <summary>
    /// Path to the shared prompts directory.
    /// </summary>
    private static string PromptsDirectory
    {
        get
        {
            var baseDir = AppContext.BaseDirectory;
            var csprojDir = Path.GetFullPath(Path.Combine(baseDir, "..", "..", ".."));
            return Path.Combine(csprojDir, "..", "prompts");
        }
    }

    private static string ChatBasicPromptyPath => Path.GetFullPath(Path.Combine(PromptsDirectory, "chat-basic.prompty"));

    public ChatTests()
    {
        // Set env vars for ${env:} resolution in prompty files
        Environment.SetEnvironmentVariable("OPENAI_API_KEY", "test-api-key");
    }

    public void Dispose()
    {
        // Clean up registries to avoid cross-test contamination
        InvokerRegistry.Clear();
        Environment.SetEnvironmentVariable("OPENAI_API_KEY", null);
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task ChatBasic_LoadsAndPrepares()
    {
        // Register renderer and parser (built into Core)
        InvokerRegistry.RegisterRenderer("jinja2", new Jinja2Renderer());
        InvokerRegistry.RegisterParser("prompty", new PromptyChatParser());

        var agent = PromptyLoader.Load(ChatBasicPromptyPath);
        var messages = await Pipeline.PrepareAsync(agent, new Dictionary<string, object?>
        {
            ["question"] = "What is Prompty?"
        });

        Assert.NotNull(messages);
        Assert.True(messages.Count >= 2, "Should have at least a system and user message");

        // Verify system message
        var systemMsg = messages.First(m => m.Role == Role.System);
        Assert.Contains("helpful assistant", systemMsg.Text);

        // Verify user message
        var userMsg = messages.First(m => m.Role == Role.User);
        Assert.Contains("What is Prompty?", userMsg.Text);
    }

    [Fact]
    public async Task ChatBasic_UsesDefaultInputs_WhenNoneProvided()
    {
        InvokerRegistry.RegisterRenderer("jinja2", new Jinja2Renderer());
        InvokerRegistry.RegisterParser("prompty", new PromptyChatParser());

        var agent = PromptyLoader.Load(ChatBasicPromptyPath);

        // Pass no inputs — should use defaults from the prompty file
        var messages = await Pipeline.PrepareAsync(agent);

        var userMsg = messages.First(m => m.Role == Role.User);
        // The default question in chat-basic.prompty is "What is Prompty?"
        Assert.Contains("What is Prompty?", userMsg.Text);
    }

    [Fact]
    public async Task ChatBasic_InvokeAsync_WithMockedExecutor()
    {
        // Register real renderer/parser
        InvokerRegistry.RegisterRenderer("jinja2", new Jinja2Renderer());
        InvokerRegistry.RegisterParser("prompty", new PromptyChatParser());

        // Create mock executor and processor
        var mockExecutor = Substitute.For<IExecutor>();
        var mockProcessor = Substitute.For<IProcessor>();

        // Mock executor returns a fake response
        mockExecutor.ExecuteAsync(Arg.Any<Prompty.Core.Prompty>(), Arg.Any<List<Message>>())
            .Returns(Task.FromResult<object>("Prompty is an asset class for LLM prompts."));

        // Mock processor passes through
        mockProcessor.ProcessAsync(Arg.Any<Prompty.Core.Prompty>(), Arg.Any<object>())
            .Returns(callInfo => Task.FromResult(callInfo.ArgAt<object>(1)));

        InvokerRegistry.RegisterExecutor("openai", mockExecutor);
        InvokerRegistry.RegisterProcessor("openai", mockProcessor);

        var result = await Pipeline.InvokeAsync(
            ChatBasicPromptyPath,
            new Dictionary<string, object?> { ["question"] = "What is Prompty?" });

        Assert.Equal("Prompty is an asset class for LLM prompts.", result);

        // Verify executor was called with messages
        await mockExecutor.Received(1).ExecuteAsync(
            Arg.Any<Prompty.Core.Prompty>(),
            Arg.Is<List<Message>>(m => m.Count >= 2));
    }

    [Fact]
    public async Task ChatPipeline_StepByStep_ProducesMessages()
    {
        InvokerRegistry.RegisterRenderer("jinja2", new Jinja2Renderer());
        InvokerRegistry.RegisterParser("prompty", new PromptyChatParser());

        var agent = PromptyLoader.Load(ChatBasicPromptyPath);
        var inputs = new Dictionary<string, object?> { ["question"] = "Hello!" };

        // Step 1: Validate inputs
        var validated = Pipeline.ValidateInputs(agent, inputs);
        Assert.True(validated.ContainsKey("question"));

        // Step 2: Render
        var rendered = await Pipeline.RenderAsync(agent, validated);
        Assert.Contains("Hello!", rendered);
        Assert.Contains("system:", rendered);

        // Step 3: Parse
        var messages = await Pipeline.ParseAsync(agent, rendered, null);
        Assert.True(messages.Count >= 2);
    }

    [Fact]
    public void ChatBasic_Load_SetsModelProperties()
    {
        var agent = PromptyLoader.Load(ChatBasicPromptyPath);

        Assert.Equal("openai-chat", agent.Name);
        Assert.Equal("gpt-4o-mini", agent.Model.Id);
        Assert.Equal("openai", agent.Model.Provider);
        Assert.Equal("chat", agent.Model.ApiType);

        // Connection
        Assert.IsType<ApiKeyConnection>(agent.Model.Connection);
        var conn = (ApiKeyConnection)agent.Model.Connection;
        Assert.Equal("test-api-key", conn.ApiKey);

        // Options
        Assert.NotNull(agent.Model.Options);
        Assert.Equal(0.7f, agent.Model.Options!.Temperature);
    }

    [Fact]
    public void ChatBasic_Load_SetsInputSchema()
    {
        var agent = PromptyLoader.Load(ChatBasicPromptyPath);

        Assert.NotNull(agent.Inputs);
        Assert.Single(agent.Inputs);

        var questionProp = agent.Inputs[0];
        Assert.Equal("question", questionProp.Name);
        Assert.Equal("string", questionProp.Kind);
    }
}
