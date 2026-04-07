// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;
using Prompty.OpenAI;
using Prompty.Foundry;

namespace Prompty.Providers.Tests.Integration;

/// <summary>
/// Integration tests — embeddings against real OpenAI and Azure/Foundry endpoints.
/// </summary>
[Trait("Category", "Integration")]
public class EmbeddingTests : IntegrationTestBase
{
    // -----------------------------------------------------------------------
    // OpenAI
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task OpenAI_SingleEmbedding()
    {
        var agent = MakeOpenAIAgent(apiType: "embedding", model: OpenAIEmbeddingModel);
        var executor = new OpenAIExecutor();
        var processor = new OpenAIProcessor();

        var messages = EmbeddingMessages("Hello world");
        var response = await executor.ExecuteAsync(agent, messages);
        var result = await processor.ProcessAsync(agent, response);

        // Single input → float array
        Assert.IsType<float[]>(result);
        var vector = (float[])result;
        Assert.NotEmpty(vector);
    }

    [SkippableFact]
    public async Task OpenAI_BatchEmbedding()
    {
        var agent = MakeOpenAIAgent(apiType: "embedding", model: OpenAIEmbeddingModel);
        var executor = new OpenAIExecutor();
        var processor = new OpenAIProcessor();

        var messages = EmbeddingMessages("Hello", "World");
        var response = await executor.ExecuteAsync(agent, messages);
        var result = await processor.ProcessAsync(agent, response);

        // Batch input → list of float arrays
        Assert.IsType<List<float[]>>(result);
        var vectors = (List<float[]>)result;
        Assert.Equal(2, vectors.Count);
        Assert.NotEmpty(vectors[0]);
        Assert.NotEmpty(vectors[1]);
    }

    // -----------------------------------------------------------------------
    // Azure / Foundry
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task Foundry_SingleEmbedding()
    {
        Skip.If(!HasAzureEmbedding, "AZURE_OPENAI_EMBEDDING_DEPLOYMENT not set");

        var agent = MakeFoundryAgent(apiType: "embedding", deployment: AzureOpenAIEmbeddingDeployment);
        var executor = new FoundryExecutor();
        var processor = new FoundryProcessor();

        var messages = EmbeddingMessages("Hello world");
        var response = await executor.ExecuteAsync(agent, messages);
        var result = await processor.ProcessAsync(agent, response);

        Assert.IsType<float[]>(result);
        var vector = (float[])result;
        Assert.NotEmpty(vector);
    }

    [SkippableFact]
    public async Task Foundry_BatchEmbedding()
    {
        Skip.If(!HasAzureEmbedding, "AZURE_OPENAI_EMBEDDING_DEPLOYMENT not set");

        var agent = MakeFoundryAgent(apiType: "embedding", deployment: AzureOpenAIEmbeddingDeployment);
        var executor = new FoundryExecutor();
        var processor = new FoundryProcessor();

        var messages = EmbeddingMessages("Hello", "World");
        var response = await executor.ExecuteAsync(agent, messages);
        var result = await processor.ProcessAsync(agent, response);

        Assert.IsType<List<float[]>>(result);
        var vectors = (List<float[]>)result;
        Assert.Equal(2, vectors.Count);
    }
}
