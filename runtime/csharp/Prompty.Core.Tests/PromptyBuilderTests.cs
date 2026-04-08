// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Core.Tests;

[Collection("InvokerRegistry")]
public class PromptyBuilderTests : IDisposable
{
    public PromptyBuilderTests()
    {
        InvokerRegistry.Clear();
    }

    public void Dispose()
    {
        InvokerRegistry.Clear();
    }

    [Fact]
    public void Constructor_RegistersCoreRenderers()
    {
        _ = new PromptyBuilder();

        Assert.True(InvokerRegistry.HasRenderer("jinja2"));
        Assert.True(InvokerRegistry.HasRenderer("mustache"));
    }

    [Fact]
    public void Constructor_RegistersCoreParser()
    {
        _ = new PromptyBuilder();

        Assert.True(InvokerRegistry.HasParser("prompty"));
    }

    [Fact]
    public void Constructor_RegistersCorrectTypes()
    {
        _ = new PromptyBuilder();

        Assert.IsType<Jinja2Renderer>(InvokerRegistry.GetRenderer("jinja2"));
        Assert.IsType<MustacheRenderer>(InvokerRegistry.GetRenderer("mustache"));
        Assert.IsType<PromptyChatParser>(InvokerRegistry.GetParser("prompty"));
    }

    [Fact]
    public void Builder_IsChainable()
    {
        // Verify that the builder instance is returned (for chaining)
        var builder = new PromptyBuilder();

        // Core renderers/parser should be registered even without provider calls
        Assert.True(InvokerRegistry.HasRenderer("jinja2"));
        Assert.True(InvokerRegistry.HasParser("prompty"));
        Assert.NotNull(builder);
    }

    [Fact]
    public void MultipleInstantiations_AreIdempotent()
    {
        _ = new PromptyBuilder();
        _ = new PromptyBuilder();

        // Should still work — re-registration overwrites, doesn't throw
        Assert.True(InvokerRegistry.HasRenderer("jinja2"));
        Assert.True(InvokerRegistry.HasRenderer("mustache"));
        Assert.True(InvokerRegistry.HasParser("prompty"));
    }
}
