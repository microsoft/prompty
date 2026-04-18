// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;
using Prompty.OpenAI;

namespace Prompty.Providers.Tests;

/// <summary>
/// Unit tests for model discovery: enrichment logic, client creation errors,
/// and ModelInfo field mapping.
/// </summary>
public class ModelDiscoveryTests
{
    #region Enrichment — exact matches

    [Theory]
    [InlineData("gpt-4o", 128000, new[] { "text", "image" }, new[] { "text" })]
    [InlineData("gpt-4o-mini", 128000, new[] { "text", "image" }, new[] { "text" })]
    [InlineData("gpt-4-turbo", 128000, new[] { "text", "image" }, new[] { "text" })]
    [InlineData("gpt-4", 8192, new[] { "text" }, new[] { "text" })]
    [InlineData("gpt-3.5-turbo", 16385, new[] { "text" }, new[] { "text" })]
    [InlineData("text-embedding-3-small", 8191, new[] { "text" }, new string[0])]
    [InlineData("text-embedding-3-large", 8191, new[] { "text" }, new string[0])]
    public void Enrich_KnownModel_SetsContextWindowAndModalities(
        string modelId, int expectedContextWindow, string[] expectedInputs, string[] expectedOutputs)
    {
        var info = new ModelInfo { Id = modelId };

        OpenAIModels.Enrich(info);

        Assert.Equal(expectedContextWindow, info.ContextWindow);
        Assert.Equal(expectedInputs, info.InputModalities);
        Assert.Equal(expectedOutputs, info.OutputModalities);
    }

    [Fact]
    public void Enrich_DallE3_NullContextWindow()
    {
        var info = new ModelInfo { Id = "dall-e-3" };

        OpenAIModels.Enrich(info);

        Assert.Null(info.ContextWindow);
        Assert.Equal(new[] { "text" }, info.InputModalities);
        Assert.Equal(new[] { "image" }, info.OutputModalities);
    }

    #endregion

    #region Enrichment — prefix matching for versioned models

    [Fact]
    public void Enrich_VersionedGpt4o_MatchesGpt4o()
    {
        var info = new ModelInfo { Id = "gpt-4o-2024-08-06" };

        OpenAIModels.Enrich(info);

        Assert.Equal(128000, info.ContextWindow);
        Assert.Equal(new[] { "text", "image" }, info.InputModalities);
    }

    [Fact]
    public void Enrich_VersionedGpt4oMini_MatchesGpt4oMini()
    {
        var info = new ModelInfo { Id = "gpt-4o-mini-2024-07-18" };

        OpenAIModels.Enrich(info);

        Assert.Equal(128000, info.ContextWindow);
        Assert.Equal(new[] { "text", "image" }, info.InputModalities);
    }

    [Fact]
    public void Enrich_VersionedGpt4_MatchesGpt4()
    {
        var info = new ModelInfo { Id = "gpt-4-0613" };

        OpenAIModels.Enrich(info);

        Assert.Equal(8192, info.ContextWindow);
        Assert.Equal(new[] { "text" }, info.InputModalities);
    }

    [Fact]
    public void Enrich_VersionedGpt35Turbo_MatchesGpt35Turbo()
    {
        var info = new ModelInfo { Id = "gpt-3.5-turbo-0125" };

        OpenAIModels.Enrich(info);

        Assert.Equal(16385, info.ContextWindow);
    }

    #endregion

    #region Enrichment — unknown models

    [Fact]
    public void Enrich_UnknownModel_LeavesFieldsNull()
    {
        var info = new ModelInfo { Id = "some-custom-model" };

        OpenAIModels.Enrich(info);

        Assert.Null(info.ContextWindow);
        Assert.Null(info.InputModalities);
        Assert.Null(info.OutputModalities);
    }

    [Fact]
    public void Enrich_PreservesExistingFields()
    {
        var info = new ModelInfo
        {
            Id = "some-custom-model",
            OwnedBy = "my-org",
            DisplayName = "My Model",
        };

        OpenAIModels.Enrich(info);

        Assert.Equal("my-org", info.OwnedBy);
        Assert.Equal("My Model", info.DisplayName);
    }

    #endregion

    #region Enrichment — case insensitivity

    [Fact]
    public void Enrich_CaseInsensitive()
    {
        var info = new ModelInfo { Id = "GPT-4O" };

        OpenAIModels.Enrich(info);

        Assert.Equal(128000, info.ContextWindow);
    }

    #endregion

    #region Client creation — error paths

    [Fact]
    public async Task ListModelsAsync_EmptyApiKey_Throws()
    {
        var conn = new ApiKeyConnection { ApiKey = "" };

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => OpenAIModels.ListModelsAsync(conn));

        Assert.Contains("API key", ex.Message);
    }

    [Fact]
    public async Task ListModelsAsync_UnsupportedConnectionKind_Throws()
    {
        var conn = new AnonymousConnection();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => OpenAIModels.ListModelsAsync(conn));

        Assert.Contains("not supported", ex.Message);
    }

    [Fact]
    public async Task ListModelsAsync_ReferenceConnection_NotRegistered_Throws()
    {
        var conn = new ReferenceConnection { Name = "nonexistent-client" };

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => OpenAIModels.ListModelsAsync(conn));

        Assert.Contains("not found in ConnectionRegistry", ex.Message);
    }

    #endregion

    #region Foundry client creation — error paths

    [Fact]
    public async Task Foundry_ListModelsAsync_NoEndpoint_Throws()
    {
        var conn = new ApiKeyConnection { ApiKey = "test-key", Endpoint = "" };

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => Foundry.FoundryModels.ListModelsAsync(conn));

        Assert.Contains("endpoint", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Foundry_ListModelsAsync_FoundryConnection_NoEndpoint_Throws()
    {
        var conn = new FoundryConnection { Endpoint = "" };

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => Foundry.FoundryModels.ListModelsAsync(conn));

        Assert.Contains("endpoint", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Foundry_ListModelsAsync_UnsupportedConnectionKind_Throws()
    {
        var conn = new AnonymousConnection();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => Foundry.FoundryModels.ListModelsAsync(conn));

        Assert.Contains("not supported", ex.Message);
    }

    [Fact]
    public async Task Foundry_ListModelsAsync_ReferenceConnection_NotRegistered_Throws()
    {
        var conn = new ReferenceConnection { Name = "nonexistent" };

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => Foundry.FoundryModels.ListModelsAsync(conn));

        Assert.Contains("not found in ConnectionRegistry", ex.Message);
    }

    #endregion
}
