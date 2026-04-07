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

    [Fact]
    public void OutputSchemaToWire_WithOutputs_ReturnsOutputConfig()
    {
        var agent = TestHelpers.CreateAgent(
            provider: "anthropic",
            outputs:
            [
                new Property { Name = "name", Kind = "string" },
                new Property { Name = "age", Kind = "integer" },
            ]);

        var config = Anthropic.AnthropicExecutor.OutputSchemaToWire(agent);

        Assert.NotNull(config);
        Assert.True(config.ContainsKey("format"));
        var format = config["format"] as Dictionary<string, object?>;
        Assert.NotNull(format);
        Assert.Equal("json_schema", format["type"]);
        Assert.True(format.ContainsKey("schema"));
    }

    [Fact]
    public void OutputSchemaToWire_NoOutputs_ReturnsNull()
    {
        var agent = TestHelpers.CreateAgent(provider: "anthropic");

        var config = Anthropic.AnthropicExecutor.OutputSchemaToWire(agent);

        Assert.Null(config);
    }
}

