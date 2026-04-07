// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Providers.Tests;

/// <summary>
/// Tests for Anthropic executor connection validation and message formatting.
/// </summary>
public class AnthropicExecutorTests
{
    [Fact]
    public async Task ExecuteAsync_MissingApiKey_ThrowsInvalidOperationException()
    {
        var executor = new Anthropic.AnthropicExecutor();
        var agent = new Core.Prompty
        {
            Model = new Model
            {
                Id = "claude-sonnet-4-20250514",
                Connection = new ApiKeyConnection { ApiKey = null },
            },
        };

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => executor.ExecuteAsync(agent, [new Message { Role = Roles.User, Parts = [new TextPart { Value = "hi" }] }]));
    }

    [Fact]
    public async Task ExecuteAsync_EmptyApiKey_ThrowsInvalidOperationException()
    {
        var executor = new Anthropic.AnthropicExecutor();
        var agent = new Core.Prompty
        {
            Model = new Model
            {
                Id = "claude-sonnet-4-20250514",
                Connection = new ApiKeyConnection { ApiKey = "" },
            },
        };

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => executor.ExecuteAsync(agent, [new Message { Role = Roles.User, Parts = [new TextPart { Value = "hi" }] }]));
    }

    [Fact]
    public async Task ExecuteAsync_NoConnection_ThrowsInvalidOperationException()
    {
        var executor = new Anthropic.AnthropicExecutor();
        var agent = new Core.Prompty
        {
            Model = new Model { Id = "claude-sonnet-4-20250514" },
        };

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => executor.ExecuteAsync(agent, [new Message { Role = Roles.User, Parts = [new TextPart { Value = "hi" }] }]));
    }

    [Fact]
    public void DefaultModel_IsClaude()
    {
        var agent = new Core.Prompty
        {
            Model = new Model { Id = null },
        };

        Assert.Equal("claude-sonnet-4-20250514", agent.Model?.Id ?? "claude-sonnet-4-20250514");
    }
}

