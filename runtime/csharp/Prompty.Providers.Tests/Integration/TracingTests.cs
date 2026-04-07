// Copyright (c) Microsoft. All rights reserved.

using System.Collections.Concurrent;
using Prompty.Core;
using Prompty.Core.Tracing;
using Prompty.OpenAI;
using Prompty.Foundry;
using Prompty.Anthropic;

namespace Prompty.Providers.Tests.Integration;

/// <summary>
/// Integration tests — verifies that tracing captures events during real LLM API calls.
/// Registers a collecting tracer backend, executes against real endpoints, and asserts
/// that the expected trace spans and emissions were recorded.
/// </summary>
[Trait("Category", "Integration")]
public class TracingTests : IntegrationTestBase
{
    private static void RegisterProviders()
    {
        if (!InvokerRegistry.HasRenderer("jinja2"))
            InvokerRegistry.RegisterRenderer("jinja2", new Jinja2Renderer());
        if (!InvokerRegistry.HasParser("prompty"))
            InvokerRegistry.RegisterParser("prompty", new PromptyChatParser());
        if (!InvokerRegistry.HasExecutor("openai"))
            InvokerRegistry.RegisterExecutor("openai", new OpenAIExecutor());
        if (!InvokerRegistry.HasProcessor("openai"))
            InvokerRegistry.RegisterProcessor("openai", new OpenAIProcessor());
        if (!InvokerRegistry.HasExecutor("foundry"))
            InvokerRegistry.RegisterExecutor("foundry", new FoundryExecutor());
        if (!InvokerRegistry.HasProcessor("foundry"))
            InvokerRegistry.RegisterProcessor("foundry", new FoundryProcessor());
        if (!InvokerRegistry.HasExecutor("anthropic"))
            InvokerRegistry.RegisterExecutor("anthropic", new AnthropicExecutor());
        if (!InvokerRegistry.HasProcessor("anthropic"))
            InvokerRegistry.RegisterProcessor("anthropic", new AnthropicProcessor());
    }

    /// <summary>
    /// Runs the given action with a temporary collecting tracer installed.
    /// Returns all captured spans. Tracer is removed after the action completes.
    /// </summary>
    private static async Task<List<CollectedSpan>> WithCollector(Func<Task> action)
    {
        var tracerName = $"test-tracer-{Guid.NewGuid():N}";
        var spans = new ConcurrentBag<CollectedSpan>();
        Tracer.Add(tracerName, spanName =>
        {
            var span = new CollectedSpan(spanName);
            spans.Add(span);
            return span;
        });

        try
        {
            await action();
        }
        finally
        {
            Tracer.Remove(tracerName);
        }

        return spans.ToList();
    }

    // -----------------------------------------------------------------------
    // OpenAI
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task OpenAI_TracingCapture()
    {
        RegisterProviders();

        var agent = MakeOpenAIAgent(options: LowTempOptions());
        var messages = HelloMessages();
        object? result = null;
        object? processed = null;

        var spans = await WithCollector(async () =>
        {
            result = await Pipeline.ExecuteAsync(agent, messages);
            processed = await Pipeline.ProcessAsync(agent, result!);
        });

        Assert.NotNull(result);
        Assert.IsType<string>(processed);
        Assert.NotEmpty((string)processed!);

        // Pipeline.ExecuteAsync and ProcessAsync emit traced spans
        Assert.True(spans.Count > 0, "Expected trace spans to be captured during OpenAI execution");
        Assert.Contains(spans, s => s.Name.Contains("ExecuteAsync", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(spans, s => s.Name.Contains("ProcessAsync", StringComparison.OrdinalIgnoreCase));

        // ExecuteAsync span emits signature and inputs
        var executeSpan = spans.First(s => s.Name.Contains("ExecuteAsync", StringComparison.OrdinalIgnoreCase));
        Assert.True(executeSpan.Emissions.ContainsKey("signature"), "Execute span should emit 'signature'");
        Assert.True(executeSpan.Emissions.ContainsKey("inputs"), "Execute span should emit 'inputs'");
    }

    // -----------------------------------------------------------------------
    // Foundry (Azure OpenAI)
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task Foundry_TracingCapture()
    {
        RegisterProviders();

        var agent = MakeFoundryAgent(options: LowTempOptions());
        var messages = HelloMessages();
        object? result = null;
        object? processed = null;

        var spans = await WithCollector(async () =>
        {
            result = await Pipeline.ExecuteAsync(agent, messages);
            processed = await Pipeline.ProcessAsync(agent, result!);
        });

        Assert.NotNull(result);
        Assert.IsType<string>(processed);
        Assert.NotEmpty((string)processed!);

        Assert.True(spans.Count > 0, "Expected trace spans to be captured during Foundry execution");
        Assert.Contains(spans, s => s.Name.Contains("ExecuteAsync", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(spans, s => s.Name.Contains("ProcessAsync", StringComparison.OrdinalIgnoreCase));

        var executeSpan = spans.First(s => s.Name.Contains("ExecuteAsync", StringComparison.OrdinalIgnoreCase));
        Assert.True(executeSpan.Emissions.ContainsKey("signature"), "Execute span should emit 'signature'");
        Assert.True(executeSpan.Emissions.ContainsKey("inputs"), "Execute span should emit 'inputs'");
    }

    // -----------------------------------------------------------------------
    // Anthropic
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task Anthropic_TracingCapture()
    {
        RegisterProviders();

        var agent = MakeAnthropicAgent(options: LowTempOptions(100));
        var messages = HelloMessages();
        object? result = null;
        object? processed = null;

        var spans = await WithCollector(async () =>
        {
            result = await Pipeline.ExecuteAsync(agent, messages);
            processed = await Pipeline.ProcessAsync(agent, result!);
        });

        Assert.NotNull(result);
        Assert.IsType<string>(processed);
        Assert.NotEmpty((string)processed!);

        Assert.True(spans.Count > 0, "Expected trace spans to be captured during Anthropic execution");
        Assert.Contains(spans, s => s.Name.Contains("ExecuteAsync", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(spans, s => s.Name.Contains("ProcessAsync", StringComparison.OrdinalIgnoreCase));

        var executeSpan = spans.First(s => s.Name.Contains("ExecuteAsync", StringComparison.OrdinalIgnoreCase));
        Assert.True(executeSpan.Emissions.ContainsKey("signature"), "Execute span should emit 'signature'");
        Assert.True(executeSpan.Emissions.ContainsKey("inputs"), "Execute span should emit 'inputs'");
    }

    // -----------------------------------------------------------------------
    // Test helper — collecting span implementation
    // -----------------------------------------------------------------------

    private sealed class CollectedSpan : ITracerSpan
    {
        public string Name { get; }
        public ConcurrentDictionary<string, object?> Emissions { get; } = new();
        public bool Disposed { get; private set; }

        public CollectedSpan(string name) => Name = name;

        public void Emit(string key, object? value) => Emissions[key] = value;

        public void Dispose() => Disposed = true;
    }
}
