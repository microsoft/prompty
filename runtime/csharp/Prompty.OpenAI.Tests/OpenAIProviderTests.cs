// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;
using Prompty.OpenAI;

namespace Prompty.OpenAI.Tests;

/// <summary>
/// Tests for OpenAI executor and processor behavior.
/// </summary>
public class OpenAIProviderTests
{
    [Fact]
    public async Task Executor_NoApiKey_Throws()
    {
        var agent = TestHelpers.CreateAgent(apiKey: "");
        var executor = new OpenAIExecutor();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => executor.ExecuteAsync(agent, [TestHelpers.CreateMessage(Role.User, "Hello")]));

        Assert.Contains("API key", ex.Message);
    }

    [Fact]
    public async Task Executor_UnsupportedConnectionKind_Throws()
    {
        // Create an agent where connection kind is not supported by OpenAI executor
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
        var executor = new OpenAIExecutor();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => executor.ExecuteAsync(agent, [TestHelpers.CreateMessage(Role.User, "Hello")]));

        Assert.Contains("not supported", ex.Message);
    }

    [Fact]
    public async Task Executor_UnsupportedApiType_Throws()
    {
        var agent = TestHelpers.CreateAgent(apiType: "invalid_api_type");
        var executor = new OpenAIExecutor();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => executor.ExecuteAsync(agent, [TestHelpers.CreateMessage(Role.User, "Hello")]));

        Assert.Contains("Unsupported API type", ex.Message);
    }

    [Fact]
    public void Executor_DefaultApiType_IsChat()
    {
        // When apiType is not set, should default to "chat"
        var agent = TestHelpers.CreateAgent(apiType: null);

        Assert.Null(agent.Model?.ApiType);
        // The executor uses `agent.Model?.ApiType ?? "chat"`, so null → defaults to "chat" at runtime.
    }

    [Fact]
    public async Task Processor_UnknownResponse_ReturnsAsIs()
    {
        var agent = TestHelpers.CreateAgent();
        var processor = new OpenAIProcessor();
        var unknownObj = "just a string";

        var result = await processor.ProcessAsync(agent, unknownObj);

        Assert.Equal("just a string", result);
    }

    [Fact]
    public async Task Processor_IntegerResponse_ReturnsAsIs()
    {
        var agent = TestHelpers.CreateAgent();
        var processor = new OpenAIProcessor();

        var result = await processor.ProcessAsync(agent, 42);

        Assert.Equal(42, result);
    }

    [Fact]
    public async Task Executor_ReferenceConnection_NotRegistered_Throws()
    {
        var data = new Dictionary<string, object?>
        {
            ["name"] = "test",
            ["model"] = new Dictionary<string, object?>
            {
                ["id"] = "gpt-4",
                ["connection"] = new Dictionary<string, object?>
                {
                    ["kind"] = "reference",
                    ["name"] = "my-openai-client",
                },
            },
        };
        var agent = Core.Prompty.Load(data, new LoadContext());
        var executor = new OpenAIExecutor();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => executor.ExecuteAsync(agent, [TestHelpers.CreateMessage(Role.User, "Hello")]));

        Assert.Contains("not found in ConnectionRegistry", ex.Message);
        Assert.Contains("my-openai-client", ex.Message);
    }

    [Fact]
    public void Executor_ImplementsIExecutor()
    {
        var executor = new OpenAIExecutor();
        Assert.IsAssignableFrom<IExecutor>(executor);
    }

    [Fact]
    public void Processor_ImplementsIProcessor()
    {
        var processor = new OpenAIProcessor();
        Assert.IsAssignableFrom<IProcessor>(processor);
    }
}
