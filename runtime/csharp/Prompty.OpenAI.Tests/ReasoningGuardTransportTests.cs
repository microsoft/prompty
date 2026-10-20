// Copyright (c) Microsoft. All rights reserved.

#pragma warning disable OPENAI001

using System.ClientModel;
using System.ClientModel.Primitives;
using System.Net;
using System.Text;
using System.Text.Json;
using OpenAI;
using Prompty.Core;

namespace Prompty.OpenAI.Tests;

public class ReasoningGuardTransportTests
{
    public static IEnumerable<object[]> Routes()
    {
        foreach (var foundry in new[] { false, true })
        foreach (var api in new[] { "chat", "responses" })
        foreach (var streaming in new[] { false, true })
        foreach (var model in new[] { "o3-mini", "gpt-4o" })
            yield return [foundry, api, streaming, model];
    }

    [Theory]
    [MemberData(nameof(Routes))]
    public async Task FiltersTheActualSdkRequest(bool foundry, string api, bool streaming, string model)
    {
        using var handler = new CaptureHandler();
        using var http = new HttpClient(handler);
        var client = new OpenAIClient(new ApiKeyCredential("offline"), new OpenAIClientOptions
        {
            Endpoint = new Uri("https://offline.invalid/v1"),
            Transport = new HttpClientPipelineTransport(http),
        });
        IExecutor executor = foundry ? new FoundryCapture(client) : new OpenAICapture(client);
        var agent = new Core.Agent
        {
            Model = new Model { Id = model, ApiType = api, Options = new ModelOptions
            {
                Temperature = 0.5f, ReasoningEffort = "high",
                AdditionalProperties = new Dictionary<string, object?>
                {
                    ["temperature"] = 0.8, ["top_p"] = 0, ["top_k"] = 0,
                    ["frequency_penalty"] = 0, ["presence_penalty"] = 0,
                    ["reasoning_effort"] = "low",
                },
            } },
            Metadata = new Dictionary<string, object?> { ["stream"] = streaming },
        };

        // The fake handler captures the real serialized request, then returns a
        // deliberate 400. No credentials, network calls, or response fixtures needed.
        await Assert.ThrowsAsync<ClientResultException>(async () =>
        {
            var result = await executor.ExecuteAsync(agent, [new Message { Role = Role.User }]);
            if (result is PromptyStream stream)
                await foreach (var _ in stream) { }
        });
        Assert.NotNull(handler.Body);
        using var document = JsonDocument.Parse(handler.Body);
        var body = document.RootElement;
        if (model == "o3-mini")
        {
            foreach (var key in new[] { "temperature", "top_p", "top_k", "frequency_penalty", "presence_penalty" })
                Assert.False(body.TryGetProperty(key, out _), $"Unexpected {key}: {body}");
            Assert.Equal("high", body.GetProperty("reasoning_effort").GetString());
        }
        else
        {
            Assert.False(body.TryGetProperty("reasoning_effort", out _));
            Assert.Equal(0.5, body.GetProperty("temperature").GetDouble());
        }
    }

    private sealed class CaptureHandler : HttpMessageHandler
    {
        public string? Body { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            Body = await request.Content!.ReadAsStringAsync(token);
            return new HttpResponseMessage(HttpStatusCode.BadRequest)
            {
                Content = new StringContent("{\"error\":{\"message\":\"offline capture\",\"type\":\"test_error\"}}", Encoding.UTF8, "application/json"),
            };
        }
    }

    private sealed class OpenAICapture(OpenAIClient client) : OpenAI.OpenAIExecutor
    {
        protected override OpenAIClient CreateClient(Core.Agent agent) => client;
    }

    private sealed class FoundryCapture(OpenAIClient client) : Foundry.FoundryExecutor
    {
        protected override OpenAIClient CreateClient(Core.Agent agent) => client;
    }
}
