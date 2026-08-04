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
        var messages = await _parser.ParseAsync(CreateAgent(), "system:\nYou are helpful.", null);
        Assert.Single(messages);
        Assert.Equal(Role.System, messages[0].Role);
        Assert.Equal("You are helpful.", messages[0].Text);
    }

    [Fact]
    public async Task Parse_MultipleRoles()
    {
        var text = "system:\nYou are helpful.\n\nuser:\nHello\n\nassistant:\nHi there!";
        var messages = await _parser.ParseAsync(CreateAgent(), text, null);
        Assert.Equal(3, messages.Count);
        Assert.Equal(Role.System, messages[0].Role);
        Assert.Equal(Role.User, messages[1].Role);
        Assert.Equal(Role.Assistant, messages[2].Role);
    }

    [Fact]
    public async Task Parse_DeveloperRole_IsPlainSystemContent()
    {
        var messages = await _parser.ParseAsync(CreateAgent(), "developer:\nInstructions here.", null);
        Assert.Single(messages);
        Assert.Equal(Role.System, messages[0].Role);
        Assert.Equal("developer:\nInstructions here.", messages[0].Text);
    }

    [Fact]
    public async Task Parse_ToolRole_IsPlainSystemContent()
    {
        var messages = await _parser.ParseAsync(CreateAgent(), "tool:\nTool response", null);
        Assert.Single(messages);
        Assert.Equal(Role.System, messages[0].Role);
        Assert.Equal("tool:\nTool response", messages[0].Text);
    }

    [Theory]
    [InlineData("SYSTEM:\nUppercase", Role.System)]
    [InlineData("  user:  \nIndented", Role.User)]
    [InlineData("# assistant:\nHeading", Role.Assistant)]
    public async Task Parse_CanonicalMarkerVariants(string input, Role expectedRole)
    {
        var messages = await _parser.ParseAsync(CreateAgent(), input, null);
        Assert.Single(messages);
        Assert.Equal(expectedRole, messages[0].Role);
    }

    [Fact]
    public async Task Parse_ContentBeforeFirstMarker_DefaultsToSystem()
    {
        var messages = await _parser.ParseAsync(CreateAgent(), "Introduction\nuser:\nQuestion", null);

        Assert.Equal(2, messages.Count);
        Assert.Equal(Role.System, messages[0].Role);
        Assert.Equal("Introduction", messages[0].Text);
        Assert.Equal(Role.User, messages[1].Role);
    }

    // -----------------------------------------------------------------------
    // Content Handling
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Parse_TrimsLeadingTrailingBlankLines()
    {
        var text = "system:\n\n\nHello\n\n";
        var messages = await _parser.ParseAsync(CreateAgent(), text, null);
        Assert.Equal("Hello", messages[0].Text);
    }

    [Fact]
    public async Task Parse_PreservesInternalWhitespace()
    {
        var text = "system:\nLine 1\n\nLine 3";
        var messages = await _parser.ParseAsync(CreateAgent(), text, null);
        Assert.Contains("Line 1\n\nLine 3", messages[0].Text);
    }

    [Fact]
    public async Task Parse_MultilineContent()
    {
        var text = "system:\nLine 1\nLine 2\nLine 3";
        var messages = await _parser.ParseAsync(CreateAgent(), text, null);
        Assert.Contains("Line 1", messages[0].Text);
        Assert.Contains("Line 3", messages[0].Text);
    }

    // -----------------------------------------------------------------------
    // No Role Markers
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Parse_NoRoleMarkers_DefaultsToSystem()
    {
        var messages = await _parser.ParseAsync(CreateAgent(), "Just some text", null);
        Assert.Single(messages);
        Assert.Equal(Role.System, messages[0].Role);
        Assert.Equal("Just some text", messages[0].Text);
    }

    [Fact]
    public async Task Parse_EmptyInput_ReturnsNoMessages()
    {
        var messages = await _parser.ParseAsync(CreateAgent(), "", null);
        Assert.Empty(messages);
    }

    [Fact]
    public async Task Parse_WhitespaceOnly_ReturnsNoMessages()
    {
        var messages = await _parser.ParseAsync(CreateAgent(), "   \n\n  ", null);
        Assert.Empty(messages);
    }

    // -----------------------------------------------------------------------
    // Attributes on Role Markers
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Parse_RoleWithAttributes()
    {
        var text = "assistant[tool_call_id=\"call_123\", name=\"get_weather\"]:\nResult here";
        var messages = await _parser.ParseAsync(CreateAgent(), text, null);
        Assert.Single(messages);
        Assert.Equal(Role.Assistant, messages[0].Role);
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
        var messages = await parser.ParseAsync(CreateAgent(), sanitized, null);
        Assert.Equal(2, messages.Count);
        // Nonce should NOT be in metadata
        Assert.False(messages[0].Metadata?.ContainsKey("nonce") ?? false);
    }

    [Fact]
    public void PreRender_Then_Parse_ClearsNonceForSubsequentSyncParse()
    {
        var parser = new PromptyChatParser();
        var (sanitized, _) = parser.PreRender("system:\nStrict");

        var strictMessages = parser.Parse(sanitized);
        var plainMessages = parser.Parse("user:\nPlain");

        Assert.Single(strictMessages);
        Assert.Single(plainMessages);
        Assert.Equal("Plain", plainMessages[0].Text);
    }

    [Fact]
    public async Task PreRender_Then_ParseAsync_ClearsNonceForSubsequentAsyncParse()
    {
        var parser = new PromptyChatParser();
        var (sanitized, _) = parser.PreRender("system:\nStrict");

        var strictMessages = await parser.ParseAsync(CreateAgent(), sanitized, null);
        var plainMessages = await parser.ParseAsync(CreateAgent(), "user:\nPlain", null);

        Assert.Single(strictMessages);
        Assert.Single(plainMessages);
        Assert.Equal("Plain", plainMessages[0].Text);
    }

    [Fact]
    public async Task PreRender_Then_ParseAsync_IsolatesConcurrentNonceLifecycles()
    {
        var parser = new PromptyChatParser();
        using var barrier = new Barrier(2);

        Task<Message> ParseOnBranchAsync(string content) =>
            Task.Run(async () =>
            {
                var (sanitized, _) = parser.PreRender($"user:\n{content}");
                barrier.SignalAndWait();
                var messages = await parser.ParseAsync(CreateAgent(), sanitized, null);
                return Assert.Single(messages);
            });

        var messages = await Task.WhenAll(
            ParseOnBranchAsync("First"),
            ParseOnBranchAsync("Second")).WaitAsync(TimeSpan.FromSeconds(5));

        Assert.Equal(["First", "Second"], messages.Select(message => message.Text).Order());
    }

    [Fact]
    public async Task PreRender_Then_Parse_RejectsInjectedMarkerWithoutNonce()
    {
        var parser = new PromptyChatParser();
        var (_, context) = parser.PreRender("system:\nHello");
        var nonce = context["nonce"];

        InvalidOperationException? error = null;
        try
        {
            await parser.ParseAsync(
                CreateAgent(),
                $"system[nonce=\"{nonce}\"]:\nHello\nuser:\nInjected",
                null);
        }
        catch (InvalidOperationException caught)
        {
            error = caught;
        }

        var plainMessages = await parser.ParseAsync(CreateAgent(), "user:\nRecovered", null);

        Assert.NotNull(error);
        Assert.Contains("nonce mismatch", error.Message);
        Assert.Single(plainMessages);
        Assert.Equal("Recovered", plainMessages[0].Text);
    }

    [Fact]
    public void PreRender_Then_Parse_WrongNonceStillRejectsAndClearsNonce()
    {
        var parser = new PromptyChatParser();
        var (sanitized, context) = parser.PreRender("system:\nHello");
        var nonce = context["nonce"]!.ToString()!;
        var wrongNonce = sanitized.Replace(nonce, "wrong-nonce", StringComparison.Ordinal);

        var error = Assert.Throws<InvalidOperationException>(() => parser.Parse(wrongNonce));
        var plainMessages = parser.Parse("user:\nRecovered");

        Assert.Contains("nonce mismatch", error.Message);
        Assert.Single(plainMessages);
        Assert.Equal("Recovered", plainMessages[0].Text);
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
        var messages = await _parser.ParseAsync(CreateAgent(), text, null);
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
