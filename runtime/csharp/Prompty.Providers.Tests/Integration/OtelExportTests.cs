// Copyright (c) Microsoft. All rights reserved.

using System.Diagnostics;
using OpenTelemetry;
using OpenTelemetry.Trace;
using Prompty.Core;
using Prompty.Core.Tracing;
using Prompty.OpenAI;
using PromptyTracer = Prompty.Core.Tracing.Tracer;

namespace Prompty.Providers.Tests.Integration;

/// <summary>
/// Integration tests verifying that Prompty's OTel tracer bridge exports
/// Activity spans to the OpenTelemetry SDK in-memory exporter.
/// Registers OTelTracer, configures an in-memory TracerProvider listening
/// to the "Prompty" ActivitySource, runs real LLM calls, and asserts on
/// exported span names, attributes, and parent-child relationships.
/// </summary>
[Trait("Category", "Integration")]
public class OtelExportTests : IntegrationTestBase
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
    }

    /// <summary>
    /// Runs the given action with OTelTracer registered and an in-memory exporter
    /// collecting all Activities from the "Prompty" ActivitySource.
    /// Returns the list of exported activities after the action completes.
    /// </summary>
    private static async Task<List<Activity>> WithOTelCollector(Func<Task> action)
    {
        var exportedActivities = new List<Activity>();
        var tracerName = $"otel-test-{Guid.NewGuid():N}";

        using var tracerProvider = Sdk.CreateTracerProviderBuilder()
            .AddSource("Prompty")
            .AddInMemoryExporter(exportedActivities)
            .Build();

        OTelTracer.Register(tracerName);

        try
        {
            await action();
        }
        finally
        {
            PromptyTracer.Remove(tracerName);
            tracerProvider.ForceFlush();
        }

        return exportedActivities;
    }

    // -----------------------------------------------------------------------
    // Span export & attributes
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task OTel_SpansExported_ForExecuteAndProcess()
    {
        RegisterProviders();

        var agent = MakeOpenAIAgent(options: LowTempOptions());
        var messages = HelloMessages();
        object? processed = null;

        var activities = await WithOTelCollector(async () =>
        {
            var result = await Pipeline.ExecuteAsync(agent, messages);
            processed = await Pipeline.ProcessAsync(agent, result);
        });

        // Verify we got a valid response
        Assert.NotNull(processed);
        Assert.IsType<string>(processed);
        Assert.NotEmpty((string)processed!);

        // Verify spans were exported
        Assert.True(activities.Count >= 2, $"Expected at least 2 exported activities, got {activities.Count}");

        // Verify ExecuteAsync and ProcessAsync spans are present
        Assert.Contains(activities, a => a.DisplayName.Contains("ExecuteAsync", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(activities, a => a.DisplayName.Contains("ProcessAsync", StringComparison.OrdinalIgnoreCase));
    }

    [SkippableFact]
    public async Task OTel_SpanAttributes_ContainPromptyTags()
    {
        RegisterProviders();

        var agent = MakeOpenAIAgent(options: LowTempOptions());
        var messages = HelloMessages();

        var activities = await WithOTelCollector(async () =>
        {
            var result = await Pipeline.ExecuteAsync(agent, messages);
            await Pipeline.ProcessAsync(agent, result);
        });

        var executeSpan = activities.FirstOrDefault(
            a => a.DisplayName.Contains("ExecuteAsync", StringComparison.OrdinalIgnoreCase));
        Assert.NotNull(executeSpan);

        // OTelTracer emits "prompty.signature" from the "signature" key
        var signatureTag = executeSpan!.Tags.FirstOrDefault(t => t.Key == "prompty.signature");
        Assert.NotNull(signatureTag.Value);
        Assert.Contains("ExecuteAsync", signatureTag.Value!, StringComparison.OrdinalIgnoreCase);

        // OTelTracer flattens "inputs" dict into "prompty.inputs.*" tags
        var inputTags = executeSpan.Tags.Where(t => t.Key.StartsWith("prompty.inputs.")).ToList();
        Assert.NotEmpty(inputTags);
    }

    [SkippableFact]
    public async Task OTel_SpanAttributes_ResultRecorded()
    {
        RegisterProviders();

        var agent = MakeOpenAIAgent(options: LowTempOptions());
        var messages = HelloMessages();

        var activities = await WithOTelCollector(async () =>
        {
            var result = await Pipeline.ExecuteAsync(agent, messages);
            await Pipeline.ProcessAsync(agent, result);
        });

        var processSpan = activities.FirstOrDefault(
            a => a.DisplayName.Contains("ProcessAsync", StringComparison.OrdinalIgnoreCase));
        Assert.NotNull(processSpan);

        // OTelTracer emits "prompty.result" from the "result" key
        var resultTag = processSpan!.Tags.FirstOrDefault(t => t.Key == "prompty.result");
        Assert.NotNull(resultTag.Value);
        Assert.NotEmpty(resultTag.Value!);
    }

    // -----------------------------------------------------------------------
    // Parent-child relationships
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task OTel_ParentChild_InvokeAsyncNestsChildSpans()
    {
        RegisterProviders();

        var agent = MakeOpenAIAgent(options: LowTempOptions());
        // InvokeAsync uses PrepareAsync which renders instructions → parses → executes.
        // Set instructions with role markers so the parser produces valid messages.
        agent.Instructions = "system:\nYou are a helpful assistant. Reply in one short sentence.\n\nuser:\nSay hello.";

        var activities = await WithOTelCollector(async () =>
        {
            await Pipeline.InvokeAsync(agent);
        });

        // InvokeAsync creates a root span that nests PrepareAsync, ExecuteAsync, ProcessAsync
        var invokeSpan = activities.FirstOrDefault(
            a => a.DisplayName.Contains("InvokeAsync", StringComparison.OrdinalIgnoreCase));
        Assert.NotNull(invokeSpan);

        // PrepareAsync, ExecuteAsync, ProcessAsync should have InvokeAsync's span as ancestor
        var childSpans = activities
            .Where(a => a.DisplayName != invokeSpan!.DisplayName && a.ParentSpanId == invokeSpan!.SpanId)
            .ToList();

        // InvokeAsync (agent overload) calls PrepareAsync and RunAsync.
        // RunAsync in turn calls ExecuteAsync and ProcessAsync.
        // So direct children of InvokeAsync are PrepareAsync and (inner) InvokeAsync or RunAsync child spans.
        Assert.True(childSpans.Count >= 1,
            $"Expected at least 1 direct child span of InvokeAsync, got {childSpans.Count}. " +
            $"Spans: [{string.Join(", ", activities.Select(a => $"{a.DisplayName}(parent={a.ParentSpanId})"))}]");

        // All activities from this InvokeAsync call should share the same TraceId
        var traceId = invokeSpan!.TraceId;
        var invokeTraceActivities = activities.Where(a => a.TraceId == traceId).ToList();
        Assert.True(invokeTraceActivities.Count >= 2,
            $"Expected at least 2 activities sharing TraceId {traceId}, got {invokeTraceActivities.Count}");
    }

    // -----------------------------------------------------------------------
    // ActivitySource metadata
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task OTel_ActivitySource_IsPrompty()
    {
        RegisterProviders();

        var agent = MakeOpenAIAgent(options: LowTempOptions());
        var messages = HelloMessages();

        var activities = await WithOTelCollector(async () =>
        {
            var result = await Pipeline.ExecuteAsync(agent, messages);
            await Pipeline.ProcessAsync(agent, result);
        });

        // All spans come from the "Prompty" ActivitySource
        Assert.All(activities, a => Assert.Equal("Prompty", a.Source.Name));
    }
}
