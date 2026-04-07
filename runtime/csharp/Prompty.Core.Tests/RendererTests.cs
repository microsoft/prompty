// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Core.Tests;

// -----------------------------------------------------------------------
// RenderHelpers Tests
// -----------------------------------------------------------------------

public class RenderHelpersTests
{
    [Fact]
    public void PrepareRenderInputs_NoRichKinds_ReturnsInputsUnchanged()
    {
        var agent = CreateAgent();
        var inputs = new Dictionary<string, object?> { ["name"] = "Jane" };
        var (result, nonces) = RenderHelpers.PrepareRenderInputs(agent, inputs);
        Assert.Equal("Jane", result["name"]);
        Assert.Empty(nonces);
    }

    [Fact]
    public void PrepareRenderInputs_ThreadKind_ReplacesWithNonce()
    {
        var agent = CreateAgentWithThreadInput("conversation");
        var inputs = new Dictionary<string, object?> { ["conversation"] = new List<Message>() };
        var (result, nonces) = RenderHelpers.PrepareRenderInputs(agent, inputs);

        var nonceValue = result["conversation"]?.ToString();
        Assert.NotNull(nonceValue);
        Assert.StartsWith(RenderHelpers.ThreadNoncePrefix, nonceValue);
        Assert.EndsWith("_conversation__", nonceValue);
        Assert.Single(nonces);
        Assert.Equal("conversation", nonces.Values.First());
    }

    [Fact]
    public void PrepareRenderInputs_NonceFormat_MatchesSpec()
    {
        var agent = CreateAgentWithThreadInput("chat");
        var inputs = new Dictionary<string, object?> { ["chat"] = new List<Message>() };
        var (result, _) = RenderHelpers.PrepareRenderInputs(agent, inputs);

        var nonce = result["chat"]?.ToString()!;
        // Spec: __PROMPTY_THREAD_{hex8}_{name}__
        Assert.Matches(@"^__PROMPTY_THREAD_[a-f0-9]{8}_chat__$", nonce);
    }

    [Fact]
    public void PrepareRenderInputs_DoesNotModifyOriginal()
    {
        var agent = CreateAgentWithThreadInput("thread");
        var original = new Dictionary<string, object?> { ["thread"] = "original" };
        var (result, _) = RenderHelpers.PrepareRenderInputs(agent, original);

        Assert.Equal("original", original["thread"]);
        Assert.NotEqual("original", result["thread"]);
    }

    [Fact]
    public void PrepareRenderInputs_MultipleRichKinds()
    {
        var agent = CreateAgentWithInputs(
            new Property { Name = "thread", Kind = "thread" },
            new Property { Name = "image", Kind = "image" },
            new Property { Name = "name", Kind = "string" }
        );
        var inputs = new Dictionary<string, object?>
        {
            ["thread"] = new List<Message>(),
            ["image"] = "img.png",
            ["name"] = "Jane",
        };
        var (result, nonces) = RenderHelpers.PrepareRenderInputs(agent, inputs);

        Assert.Equal(2, nonces.Count);
        Assert.Equal("Jane", result["name"]); // Non-rich kinds unchanged
    }

    private static Prompty CreateAgent() => CreateAgentWithInputs();

    private static Prompty CreateAgentWithThreadInput(string name) =>
        CreateAgentWithInputs(new Property { Name = name, Kind = "thread" });

    private static Prompty CreateAgentWithInputs(params Property[] props)
    {
        var data = new Dictionary<string, object?>
        {
            ["kind"] = "prompt",
            ["name"] = "test",
            ["instructions"] = "",
            ["model"] = "gpt-4",
        };
        var agent = Prompty.Load(data, new LoadContext());
        agent.Inputs = [.. props];
        return agent;
    }
}

// -----------------------------------------------------------------------
// Jinja2Renderer Tests
// -----------------------------------------------------------------------

public class Jinja2RendererTests
{
    private readonly Jinja2Renderer _renderer = new();

    [Fact]
    public async Task Render_SimpleVariable()
    {
        var agent = CreateAgent();
        var result = await _renderer.RenderAsync(agent, "Hello {{ name }}!", new() { ["name"] = "Jane" });
        Assert.Equal("Hello Jane!", result);
    }

    [Fact]
    public async Task Render_MultipleVariables()
    {
        var agent = CreateAgent();
        var result = await _renderer.RenderAsync(
            agent,
            "{{ greeting }}, {{ name }}!",
            new() { ["greeting"] = "Hi", ["name"] = "Bob" });
        Assert.Equal("Hi, Bob!", result);
    }

    [Fact]
    public async Task Render_Conditional()
    {
        var agent = CreateAgent();
        var template = "{% if admin %}Admin{% else %}User{% endif %}";
        var result = await _renderer.RenderAsync(agent, template, new() { ["admin"] = true });
        Assert.Equal("Admin", result);
    }

    [Fact]
    public async Task Render_Loop()
    {
        var agent = CreateAgent();
        var template = "Items: {% for item in items %}[{{ item }}]{% endfor %}";
        var result = await _renderer.RenderAsync(
            agent, template,
            new() { ["items"] = new List<string> { "a", "b", "c" } });
        Assert.Equal("Items: [a][b][c]", result);
    }

    [Fact]
    public async Task Render_PreservesRoleMarkers()
    {
        var agent = CreateAgent();
        var template = "system:\nYou are helpful.\n\nuser:\n{{ question }}";
        var result = await _renderer.RenderAsync(agent, template, new() { ["question"] = "Hi" });
        Assert.Contains("system:", result);
        Assert.Contains("user:", result);
        Assert.Contains("Hi", result);
    }

    [Fact]
    public async Task Render_ThreadNonces_ReplacedInOutput()
    {
        var agent = CreateAgentWithThreadInput("conversation");
        var template = "system:\nHello\n{{conversation}}user:\n{{ question }}";
        var result = await _renderer.RenderAsync(
            agent, template,
            new() { ["conversation"] = new List<Message>(), ["question"] = "Hi" });

        Assert.Matches(@"__PROMPTY_THREAD_[a-f0-9]{8}_conversation__", result);
        Assert.Single(_renderer.LastNonces);
    }

    [Fact]
    public async Task Render_EmptyTemplate()
    {
        var agent = CreateAgent();
        var result = await _renderer.RenderAsync(agent, "", new());
        Assert.Equal("", result);
    }

    private static Prompty CreateAgent() =>
        CreateAgentBase();

    private static Prompty CreateAgentWithThreadInput(string name)
    {
        var agent = CreateAgentBase();
        agent.Inputs = [new Property { Name = name, Kind = "thread" }];
        return agent;
    }

    private static Prompty CreateAgentBase()
    {
        var data = new Dictionary<string, object?>
        {
            ["kind"] = "prompt",
            ["name"] = "test",
            ["instructions"] = "",
            ["model"] = "gpt-4",
        };
        return Prompty.Load(data, new LoadContext());
    }
}

// -----------------------------------------------------------------------
// MustacheRenderer Tests
// -----------------------------------------------------------------------

public class MustacheRendererTests
{
    private readonly MustacheRenderer _renderer = new();

    [Fact]
    public async Task Render_SimpleVariable()
    {
        var agent = CreateAgent();
        var result = await _renderer.RenderAsync(agent, "Hello {{name}}!", new() { ["name"] = "Jane" });
        Assert.Equal("Hello Jane!", result);
    }

    [Fact]
    public async Task Render_MultipleVariables()
    {
        var agent = CreateAgent();
        var result = await _renderer.RenderAsync(
            agent, "{{greeting}}, {{name}}!",
            new() { ["greeting"] = "Hi", ["name"] = "Bob" });
        Assert.Equal("Hi, Bob!", result);
    }

    [Fact]
    public async Task Render_Section()
    {
        var agent = CreateAgent();
        var template = "{{#items}}{{.}} {{/items}}";
        var result = await _renderer.RenderAsync(
            agent, template,
            new() { ["items"] = new List<string> { "a", "b", "c" } });
        Assert.Equal("a b c ", result);
    }

    private static Prompty CreateAgent()
    {
        var data = new Dictionary<string, object?>
        {
            ["kind"] = "prompt",
            ["name"] = "test",
            ["instructions"] = "",
            ["model"] = "gpt-4",
        };
        return Prompty.Load(data, new LoadContext());
    }
}
