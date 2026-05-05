// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;
using Prompty.Foundry;
using Prompty.OpenAI;

namespace Prompty.Providers.Tests.Integration;

/// <summary>
/// Integration tests — provider model listing against real endpoints.
/// </summary>
[Trait("Category", "Integration")]
public class ModelListingTests : IntegrationTestBase
{
    [SkippableFact]
    public async Task OpenAI_ListModels()
    {
        Skip.If(!HasOpenAI, "OPENAI_API_KEY is not set.");

        var connection = new ApiKeyConnection
        {
            ApiKey = OpenAIApiKey!,
        };
        if (!string.IsNullOrEmpty(OpenAIBaseUrl))
            connection.Endpoint = OpenAIBaseUrl;

        var models = await OpenAIModels.ListModelsAsync(connection);

        Assert.NotEmpty(models);
        Assert.False(string.IsNullOrEmpty(models[0].Id));
    }

    [SkippableFact]
    public async Task Foundry_ListModels()
    {
        Skip.If(!HasAzure, "Azure OpenAI env vars are not set.");

        var connection = new ApiKeyConnection
        {
            ApiKey = AzureOpenAIApiKey!,
            Endpoint = AzureOpenAIEndpoint!,
        };

        var models = await FoundryModels.ListModelsAsync(connection);

        Assert.NotEmpty(models);
        Assert.False(string.IsNullOrEmpty(models[0].Id));
    }
}
