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

    private static Agent CreateAgent() => CreateAgentWithInputs();

    private static Agent CreateAgentWithThreadInput(string name) =>
        CreateAgentWithInputs(new Property { Name = name, Kind = "thread" });

    private static Agent CreateAgentWithInputs(params Property[] props)
    {
        var data = new Dictionary<string, object?>
        {
            ["kind"] = "prompt",
            ["name"] = "test",
            ["instructions"] = "",
            ["model"] = "gpt-4",
        };
        var agent = Agent.Load(data, new LoadContext());
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

    private static Agent CreateAgent() =>
        CreateAgentBase();

    private static Agent CreateAgentWithThreadInput(string name)
    {
        var agent = CreateAgentBase();
        agent.Inputs = [new Property { Name = name, Kind = "thread" }];
        return agent;
    }

    private static Agent CreateAgentBase()
    {
        var data = new Dictionary<string, object?>
        {
            ["kind"] = "prompt",
            ["name"] = "test",
            ["instructions"] = "",
            ["model"] = "gpt-4",
        };
        return Agent.Load(data, new LoadContext());
    }
}

// -----------------------------------------------------------------------
// Input Sanitization Tests (issue #432 — sibling of GHSA-w28w-gp39-m4p6)
// -----------------------------------------------------------------------

public class RenderInputSanitizationTests
{
    private readonly Jinja2Renderer _renderer = new();

    [Theory]
    [InlineData("__proto__")]
    [InlineData("constructor")]
    [InlineData("prototype")]
    public void SanitizeInputs_StripsUnsafeTopLevelKeys(string unsafeKey)
    {
        var inputs = new Dictionary<string, object?>
        {
            [unsafeKey] = "attack",
            ["name"] = "Jane",
        };

        var result = RenderHelpers.SanitizeInputs(inputs);

        Assert.False(result.ContainsKey(unsafeKey));
        Assert.Equal("Jane", result["name"]);
    }

    [Fact]
    public void SanitizeInputs_StripsUnsafeKeysInNestedDictionaries()
    {
        var inputs = new Dictionary<string, object?>
        {
            ["profile"] = new Dictionary<string, object?>
            {
                ["constructor"] = "attack",
                ["displayName"] = "Jane",
            },
        };

        var result = RenderHelpers.SanitizeInputs(inputs);

        var profile = Assert.IsType<Dictionary<string, object?>>(result["profile"]);
        Assert.False(profile.ContainsKey("constructor"));
        Assert.Equal("Jane", profile["displayName"]);
    }

    [Fact]
    public void SanitizeInputs_StripsUnsafeKeysInsideCollections()
    {
        var inputs = new Dictionary<string, object?>
        {
            ["items"] = new List<object?>
            {
                new Dictionary<string, object?> { ["__proto__"] = "attack", ["value"] = 1 },
            },
        };

        var result = RenderHelpers.SanitizeInputs(inputs);

        var list = Assert.IsType<List<object?>>(result["items"]);
        var entry = Assert.IsType<Dictionary<string, object?>>(list[0]);
        Assert.False(entry.ContainsKey("__proto__"));
        Assert.Equal(1, entry["value"]);
    }

    [Fact]
    public void SanitizeInputs_DoesNotMutateOriginal()
    {
        var inputs = new Dictionary<string, object?> { ["__proto__"] = "attack", ["name"] = "Jane" };

        RenderHelpers.SanitizeInputs(inputs);

        Assert.True(inputs.ContainsKey("__proto__"));
    }

    [Fact]
    public void SanitizeInputs_HandlesCyclicReferences()
    {
        var cyclic = new Dictionary<string, object?> { ["name"] = "Jane" };
        cyclic["self"] = cyclic;
        var inputs = new Dictionary<string, object?> { ["node"] = cyclic };

        var result = RenderHelpers.SanitizeInputs(inputs);

        var node = Assert.IsType<Dictionary<string, object?>>(result["node"]);
        Assert.Equal("Jane", node["name"]);
        Assert.Null(node["self"]); // cycle broken, not infinite recursion
    }

    [Fact]
    public async Task Render_DoesNotExposeConstructorMember()
    {
        var agent = CreateAgentBase();
        // Without sanitization, {{ obj.constructor }} could reach the prototype chain.
        var result = await _renderer.RenderAsync(
            agent,
            "{{ obj.constructor }}",
            new() { ["obj"] = new Dictionary<string, object?> { ["constructor"] = "leaked" } });

        Assert.DoesNotContain("leaked", result);
    }

    [Fact]
    public async Task Render_NormalInputsStillWork()
    {
        var agent = CreateAgentBase();
        var result = await _renderer.RenderAsync(agent, "Hello {{ name }}!", new() { ["name"] = "Jane" });
        Assert.Equal("Hello Jane!", result);
    }

    private static Agent CreateAgentBase()
    {
        var data = new Dictionary<string, object?>
        {
            ["kind"] = "prompt",
            ["name"] = "test",
            ["instructions"] = "",
            ["model"] = "gpt-4",
        };
        return Agent.Load(data, new LoadContext());
    }
}

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

    private static Agent CreateAgent()
    {
        var data = new Dictionary<string, object?>
        {
            ["kind"] = "prompt",
            ["name"] = "test",
            ["instructions"] = "",
            ["model"] = "gpt-4",
        };
        return Agent.Load(data, new LoadContext());
    }
}
