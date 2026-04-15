// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Core.Tests;

public class PromptyChatParserTests
{
    private readonly PromptyChatParser _parser = new();

    // -----------------------------------------------------------------------
    // Basic Role Splitting
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Parse_SingleSystemRole()
    {
        var messages = await _parser.ParseAsync(CreateAgent(), "system:\nYou are helpful.");
        Assert.Single(messages);
        Assert.Equal(Roles.System, messages[0].Role);
        Assert.Equal("You are helpful.", messages[0].Text);
    }

    [Fact]
    public async Task Parse_MultipleRoles()
    {
        var text = "system:\nYou are helpful.\n\nuser:\nHello\n\nassistant:\nHi there!";
        var messages = await _parser.ParseAsync(CreateAgent(), text);
        Assert.Equal(3, messages.Count);
        Assert.Equal(Roles.System, messages[0].Role);
        Assert.Equal(Roles.User, messages[1].Role);
        Assert.Equal(Roles.Assistant, messages[2].Role);
    }

    [Fact]
    public async Task Parse_DeveloperRole()
    {
        var messages = await _parser.ParseAsync(CreateAgent(), "developer:\nInstructions here.");
        Assert.Single(messages);
        Assert.Equal(Roles.Developer, messages[0].Role);
    }

    [Fact]
    public async Task Parse_ToolRole()
    {
        var messages = await _parser.ParseAsync(CreateAgent(), "tool:\nTool response");
        Assert.Single(messages);
        Assert.Equal(Roles.Tool, messages[0].Role);
    }

    // -----------------------------------------------------------------------
    // Content Handling
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Parse_TrimsLeadingTrailingBlankLines()
    {
        var text = "system:\n\n\nHello\n\n";
        var messages = await _parser.ParseAsync(CreateAgent(), text);
        Assert.Equal("Hello", messages[0].Text);
    }

    [Fact]
    public async Task Parse_PreservesInternalWhitespace()
    {
        var text = "system:\nLine 1\n\nLine 3";
        var messages = await _parser.ParseAsync(CreateAgent(), text);
        Assert.Contains("Line 1\n\nLine 3", messages[0].Text);
    }

    [Fact]
    public async Task Parse_MultilineContent()
    {
        var text = "system:\nLine 1\nLine 2\nLine 3";
        var messages = await _parser.ParseAsync(CreateAgent(), text);
        Assert.Contains("Line 1", messages[0].Text);
        Assert.Contains("Line 3", messages[0].Text);
    }

    // -----------------------------------------------------------------------
    // No Role Markers
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Parse_NoRoleMarkers_DefaultsToSystem()
    {
        var messages = await _parser.ParseAsync(CreateAgent(), "Just some text");
        Assert.Single(messages);
        Assert.Equal(Roles.System, messages[0].Role);
        Assert.Equal("Just some text", messages[0].Text);
    }

    [Fact]
    public async Task Parse_EmptyInput_ReturnsNoMessages()
    {
        var messages = await _parser.ParseAsync(CreateAgent(), "");
        Assert.Empty(messages);
    }

    [Fact]
    public async Task Parse_WhitespaceOnly_ReturnsNoMessages()
    {
        var messages = await _parser.ParseAsync(CreateAgent(), "   \n\n  ");
        Assert.Empty(messages);
    }

    // -----------------------------------------------------------------------
    // Attributes on Role Markers
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Parse_RoleWithAttributes()
    {
        var text = "tool[tool_call_id=\"call_123\", name=\"get_weather\"]:\nResult here";
        var messages = await _parser.ParseAsync(CreateAgent(), text);
        Assert.Single(messages);
        Assert.Equal(Roles.Tool, messages[0].Role);
        Assert.Equal("call_123", messages[0].Metadata["tool_call_id"]);
        Assert.Equal("get_weather", messages[0].Metadata["name"]);
    }

    // -----------------------------------------------------------------------
    // PreRender (Strict Mode)
    // -----------------------------------------------------------------------

    [Fact]
    public void PreRender_InjectsNonce()
    {
        var template = "system:\nHello\n\nuser:\nWorld";
        var (sanitized, context) = _parser.PreRender(template);

        Assert.Contains("nonce=", sanitized);
        Assert.True(context.ContainsKey("nonce"));
        Assert.NotNull(context["nonce"]);
    }

    [Fact]
    public void PreRender_AllRoleMarkersGetNonce()
    {
        var template = "system:\nA\n\nuser:\nB\n\nassistant:\nC";
        var (sanitized, context) = _parser.PreRender(template);

        var nonce = context["nonce"]!.ToString()!;
        // Count occurrences of nonce in sanitized template
        var count = sanitized.Split(nonce).Length - 1;
        Assert.Equal(3, count); // 3 role markers
    }

    [Fact]
    public async Task PreRender_Then_Parse_ValidatesNonce()
    {
        var parser = new PromptyChatParser();
        var template = "system:\nHello\n\nuser:\nWorld";
        var (sanitized, _) = parser.PreRender(template);

        // Parsing the pre-rendered template should work (nonce matches)
        var messages = await parser.ParseAsync(CreateAgent(), sanitized);
        Assert.Equal(2, messages.Count);
        // Nonce should NOT be in metadata
        Assert.False(messages[0].Metadata?.ContainsKey("nonce") ?? false);
    }

    // -----------------------------------------------------------------------
    // Thread Nonce Pattern Recognition
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Parse_ThreadNonce_InContent()
    {
        // Thread nonces appear in rendered text; parser should preserve them as-is
        // (thread expansion happens in pipeline, not parser)
        var text = "system:\nYou are helpful.\n__PROMPTY_THREAD_abcd1234_conversation__\nuser:\nHello";
        var messages = await _parser.ParseAsync(CreateAgent(), text);
        Assert.Equal(2, messages.Count);
        Assert.Contains("__PROMPTY_THREAD_abcd1234_conversation__", messages[0].Text);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

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
