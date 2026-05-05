// Copyright (c) Microsoft. All rights reserved.

using System.ClientModel;
using System.ClientModel.Primitives;
using System.Text.Json;
using System.Text.Json.Nodes;
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
/// Replaces the OpenAI SDK's default Authorization header with an Entra ID bearer token.
/// </summary>
internal sealed class BearerTokenAuthPolicy(TokenCredential credential, string scope) : PipelinePolicy
{
    public override void Process(PipelineMessage message, IReadOnlyList<PipelinePolicy> pipeline, int currentIndex)
    {
        SetBearerToken(message);
        ProcessNext(message, pipeline, currentIndex);
    }

    public override async ValueTask ProcessAsync(PipelineMessage message, IReadOnlyList<PipelinePolicy> pipeline, int currentIndex)
    {
        await SetBearerTokenAsync(message);
        await ProcessNextAsync(message, pipeline, currentIndex);
    }

    private void SetBearerToken(PipelineMessage message)
    {
        var token = credential.GetToken(new TokenRequestContext([scope]), default);
        message.Request.Headers.Set("Authorization", $"Bearer {token.Token}");
    }

    private async ValueTask SetBearerTokenAsync(PipelineMessage message)
    {
        var token = await credential.GetTokenAsync(new TokenRequestContext([scope]), default);
        message.Request.Headers.Set("Authorization", $"Bearer {token.Token}");
    }
}

/// <summary>
/// Patches Azure.AI.OpenAI's request body to ensure <c>max_completion_tokens</c> is used
/// instead of the deprecated <c>max_tokens</c>.
/// The Azure SDK may swap the parameter name; this policy reverses that swap.
/// </summary>
internal sealed class MaxTokensPatchPolicy : PipelinePolicy
{
    public override void Process(PipelineMessage message, IReadOnlyList<PipelinePolicy> pipeline, int currentIndex)
    {
        PatchRequestBody(message);
        ProcessNext(message, pipeline, currentIndex);
    }

    public override async ValueTask ProcessAsync(PipelineMessage message, IReadOnlyList<PipelinePolicy> pipeline, int currentIndex)
    {
        PatchRequestBody(message);
        await ProcessNextAsync(message, pipeline, currentIndex);
    }

    private static void PatchRequestBody(PipelineMessage message)
    {
        var content = message.Request.Content;
        if (content is null) return;

        // Read the request body
        using var ms = new MemoryStream();
        content.WriteTo(ms, default);
        var bytes = ms.ToArray();
        if (bytes.Length == 0) return;

        var json = JsonNode.Parse(bytes);
        if (json is not JsonObject obj) return;

        // Swap max_tokens → max_completion_tokens if present
        if (obj.ContainsKey("max_tokens") && !obj.ContainsKey("max_completion_tokens"))
        {
            var value = obj["max_tokens"];
            obj.Remove("max_tokens");
            obj["max_completion_tokens"] = value?.DeepClone();

            var patched = obj.ToJsonString(new JsonSerializerOptions { WriteIndented = false });
            message.Request.Content = BinaryContent.Create(new BinaryData(patched));
        }
    }
}
