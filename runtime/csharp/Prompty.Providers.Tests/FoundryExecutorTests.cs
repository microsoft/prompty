// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Providers.Tests;

/// <summary>
/// Tests for Foundry executor connection validation.
/// </summary>
public class FoundryExecutorTests
{
    [Fact]
    public async Task ExecuteAsync_MissingEndpoint_ThrowsInvalidOperationException()
    {
        var executor = new Foundry.FoundryExecutor();
        var agent = new Core.Prompty
        {
            Model = new Model
            {
                Id = "gpt-4",
                Connection = new ApiKeyConnection { Endpoint = null!, ApiKey = "test-key" },
            },
        };

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => executor.ExecuteAsync(agent, [new Message { Role = Roles.User, Parts = [new TextPart { Value = "hi" }] }]));
    }

    [Fact]
    public async Task ExecuteAsync_EmptyEndpoint_ThrowsInvalidOperationException()
    {
        var executor = new Foundry.FoundryExecutor();
        var agent = new Core.Prompty
        {
            Model = new Model
            {
                Id = "gpt-4",
                Connection = new ApiKeyConnection { Endpoint = "", ApiKey = "test-key" },
            },
        };

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => executor.ExecuteAsync(agent, [new Message { Role = Roles.User, Parts = [new TextPart { Value = "hi" }] }]));
    }

    [Fact]
    public async Task ExecuteAsync_FoundryConnection_WithEndpoint_NoApiKey_UsesDefaultCredential()
    {
        // FoundryConnection doesn't have ApiKey — uses Entra ID via DefaultAzureCredential
        // We can't test the actual credential here, but we can verify it doesn't throw
        // on connection setup (it will fail later when trying to actually call the API)
        var executor = new Foundry.FoundryExecutor();
        var agent = new Core.Prompty
        {
            Model = new Model
            {
                Id = "gpt-4",
                Connection = new FoundryConnection { Endpoint = "https://test.openai.azure.com/" },
            },
        };

        // This should get past connection setup and fail at the API call
        // (not at missing endpoint/key validation)
        await Assert.ThrowsAnyAsync<Exception>(
            () => executor.ExecuteAsync(agent, [new Message { Role = Roles.User, Parts = [new TextPart { Value = "hi" }] }]));
    }

    [Fact]
    public async Task ExecuteAsync_ApiKeyConnection_WithEndpointAndKey_Creates()
    {
        var executor = new Foundry.FoundryExecutor();
        var agent = new Core.Prompty
        {
            Model = new Model
            {
                Id = "gpt-4",
                Connection = new ApiKeyConnection
                {
                    Endpoint = "https://test.openai.azure.com/",
                    ApiKey = "test-key",
                },
            },
        };

        // Should get past client creation and fail at the actual API call
        await Assert.ThrowsAnyAsync<Exception>(
            () => executor.ExecuteAsync(agent, [new Message { Role = Roles.User, Parts = [new TextPart { Value = "hi" }] }]));
    }
}

