// Copyright (c) Microsoft. All rights reserved.

using System.ClientModel.Primitives;
using Azure.Core;

namespace Prompty.Foundry;

/// <summary>
/// Adds the api-version query parameter required by Azure OpenAI endpoints.
/// </summary>
internal sealed class AzureApiVersionPolicy(string apiVersion) : PipelinePolicy
{
    public override void Process(PipelineMessage message, IReadOnlyList<PipelinePolicy> pipeline, int currentIndex)
    {
        AddApiVersion(message);
        ProcessNext(message, pipeline, currentIndex);
    }

    public override async ValueTask ProcessAsync(PipelineMessage message, IReadOnlyList<PipelinePolicy> pipeline, int currentIndex)
    {
        AddApiVersion(message);
        await ProcessNextAsync(message, pipeline, currentIndex);
    }

    private void AddApiVersion(PipelineMessage message)
    {
        var uri = message.Request.Uri!;
        var builder = new UriBuilder(uri);
        builder.Query = string.IsNullOrEmpty(builder.Query)
            ? $"api-version={apiVersion}"
            : $"{builder.Query.TrimStart('?')}&api-version={apiVersion}";
        message.Request.Uri = builder.Uri;
    }
}

/// <summary>
/// Replaces the OpenAI SDK's default Authorization header with Azure's api-key header.
/// </summary>
internal sealed class AzureApiKeyAuthPolicy(string apiKey) : PipelinePolicy
{
    public override void Process(PipelineMessage message, IReadOnlyList<PipelinePolicy> pipeline, int currentIndex)
    {
        SetApiKey(message);
        ProcessNext(message, pipeline, currentIndex);
    }

    public override async ValueTask ProcessAsync(PipelineMessage message, IReadOnlyList<PipelinePolicy> pipeline, int currentIndex)
    {
        SetApiKey(message);
        await ProcessNextAsync(message, pipeline, currentIndex);
    }

    private void SetApiKey(PipelineMessage message)
    {
        message.Request.Headers.Remove("Authorization");
        message.Request.Headers.Set("api-key", apiKey);
    }
}

/// <summary>
/// Uses Azure.Identity TokenCredential for Entra ID bearer token authentication.
/// Replaces the OpenAI SDK's default Authorization header with a fresh bearer token.
/// </summary>
internal sealed class AzureBearerTokenPolicy(TokenCredential credential, string[] scopes) : PipelinePolicy
{
    public override void Process(PipelineMessage message, IReadOnlyList<PipelinePolicy> pipeline, int currentIndex)
    {
        var token = credential.GetToken(new TokenRequestContext(scopes), default);
        message.Request.Headers.Set("Authorization", $"Bearer {token.Token}");
        ProcessNext(message, pipeline, currentIndex);
    }

    public override async ValueTask ProcessAsync(PipelineMessage message, IReadOnlyList<PipelinePolicy> pipeline, int currentIndex)
    {
        var token = await credential.GetTokenAsync(new TokenRequestContext(scopes), default);
        message.Request.Headers.Set("Authorization", $"Bearer {token.Token}");
        await ProcessNextAsync(message, pipeline, currentIndex);
    }
}
