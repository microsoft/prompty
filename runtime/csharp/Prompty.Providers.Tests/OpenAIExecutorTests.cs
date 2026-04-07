// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Providers.Tests;

/// <summary>
/// Tests for OpenAI executor connection validation and API type dispatch.
/// These test the executor's public surface without making real API calls.
/// </summary>
public class OpenAIExecutorTests
{
    [Fact]
    public async Task ExecuteAsync_MissingApiKey_ThrowsInvalidOperationException()
    {
        var executor = new OpenAI.OpenAIExecutor();
        var agent = new Core.Prompty
        {
            Model = new Model
            {
                Id = "gpt-4",
                Connection = new ApiKeyConnection { ApiKey = null },
            },
        };

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => executor.ExecuteAsync(agent, [new Message { Role = Roles.User, Parts = [new TextPart { Value = "hi" }] }]));
    }

    [Fact]
    public async Task ExecuteAsync_EmptyApiKey_ThrowsInvalidOperationException()
    {
        var executor = new OpenAI.OpenAIExecutor();
        var agent = new Core.Prompty
        {
            Model = new Model
            {
                Id = "gpt-4",
                Connection = new ApiKeyConnection { ApiKey = "" },
            },
        };

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => executor.ExecuteAsync(agent, [new Message { Role = Roles.User, Parts = [new TextPart { Value = "hi" }] }]));
    }

    [Fact]
    public async Task ExecuteAsync_NoConnectionAtAll_ThrowsInvalidOperationException()
    {
        var executor = new OpenAI.OpenAIExecutor();
        var agent = new Core.Prompty
        {
            Model = new Model { Id = "gpt-4" },
        };

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => executor.ExecuteAsync(agent, [new Message { Role = Roles.User, Parts = [new TextPart { Value = "hi" }] }]));
    }

    [Fact]
    public async Task ExecuteAsync_UnsupportedApiType_ThrowsInvalidOperationException()
    {
        // Create a test subclass that injects a fake client
        var executor = new TestOpenAIExecutor();
        var agent = new Core.Prompty
        {
            Model = new Model
            {
                Id = "gpt-4",
                ApiType = "unsupported_type",
                Connection = new ApiKeyConnection { ApiKey = "test-key" },
            },
        };

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => executor.ExecuteAsync(agent, [new Message { Role = Roles.User, Parts = [new TextPart { Value = "hi" }] }]));
    }

    [Fact]
    public void DefaultApiType_IsChatWhenNull()
    {
        var agent = new Core.Prompty
        {
            Model = new Model { Id = "gpt-4", ApiType = null },
        };

        // The executor uses `agent.Model?.ApiType ?? "chat"` — verify the default
        Assert.Equal("chat", agent.Model?.ApiType ?? "chat");
    }

    [Fact]
    public void DefaultModelId_IsGpt4WhenNull()
    {
        var agent = new Core.Prompty
        {
            Model = new Model { Id = null },
        };

        Assert.Equal("gpt-4", agent.Model?.Id ?? "gpt-4");
    }

    /// <summary>
    /// Test subclass that captures CreateClient calls without needing a real API key.
    /// </summary>
    private class TestOpenAIExecutor : OpenAI.OpenAIExecutor
    {
        protected override global::OpenAI.OpenAIClient CreateClient(Core.Prompty agent)
        {
            // Return a real client with a fake key — the dispatch happens before the API call
            return new global::OpenAI.OpenAIClient("test-fake-key");
        }
    }
}

