// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;
using Prompty.Foundry;

namespace Prompty.Providers.Tests;

/// <summary>
/// Tests for Foundry executor and processor behavior.
/// </summary>
public class FoundryProviderTests
{
    [Fact]
    public async Task Executor_NoEndpoint_Throws()
    {
        var data = new Dictionary<string, object?>
        {
            ["name"] = "test",
            ["model"] = new Dictionary<string, object?>
            {
                ["id"] = "gpt-4",
                ["provider"] = "foundry",
                ["connection"] = new Dictionary<string, object?>
                {
                    ["kind"] = "key",
                    ["apiKey"] = "some-key",
                    // No endpoint
                },
            },
        };
        var agent = Core.Prompty.Load(data, new LoadContext());
        var executor = new FoundryExecutor();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => executor.ExecuteAsync(agent, [TestHelpers.CreateMessage(Roles.User, "Hello")]));

        Assert.Contains("endpoint", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Executor_FoundryConnection_NoEndpoint_Throws()
    {
        var data = new Dictionary<string, object?>
        {
            ["name"] = "test",
            ["model"] = new Dictionary<string, object?>
            {
                ["id"] = "gpt-4",
                ["provider"] = "foundry",
                ["connection"] = new Dictionary<string, object?>
                {
                    ["kind"] = "foundry",
                    // FoundryConnection with no endpoint
                },
            },
        };
        var agent = Core.Prompty.Load(data, new LoadContext());
        var executor = new FoundryExecutor();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => executor.ExecuteAsync(agent, [TestHelpers.CreateMessage(Roles.User, "Hello")]));

        Assert.Contains("endpoint", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Executor_InheritsFromOpenAI()
    {
        var executor = new FoundryExecutor();

        Assert.IsAssignableFrom<Prompty.OpenAI.OpenAIExecutor>(executor);
        Assert.IsAssignableFrom<IExecutor>(executor);
    }

    [Fact]
    public void Processor_InheritsFromOpenAI()
    {
        var processor = new FoundryProcessor();

        Assert.IsAssignableFrom<Prompty.OpenAI.OpenAIProcessor>(processor);
        Assert.IsAssignableFrom<IProcessor>(processor);
    }

    [Fact]
    public async Task Processor_UnknownResponse_ReturnsAsIs()
    {
        var agent = TestHelpers.CreateAgent(provider: "foundry");
        var processor = new FoundryProcessor();

        var result = await processor.ProcessAsync(agent, "raw string");

        Assert.Equal("raw string", result);
    }

    [Fact]
    public async Task Executor_AnonymousConnection_NoEndpoint_Throws()
    {
        // Anonymous connection also lacks endpoint
        var data = new Dictionary<string, object?>
        {
            ["name"] = "test",
            ["model"] = new Dictionary<string, object?>
            {
                ["id"] = "gpt-4",
                ["connection"] = new Dictionary<string, object?>
                {
                    ["kind"] = "anonymous",
                },
            },
        };
        var agent = Core.Prompty.Load(data, new LoadContext());
        var executor = new FoundryExecutor();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => executor.ExecuteAsync(agent, [TestHelpers.CreateMessage(Roles.User, "Hello")]));

        Assert.Contains("endpoint", ex.Message, StringComparison.OrdinalIgnoreCase);
    }
}
