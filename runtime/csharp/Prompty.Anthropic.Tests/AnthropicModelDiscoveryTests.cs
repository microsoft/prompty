// Copyright (c) Microsoft. All rights reserved.

using System.Net;
using System.Net.Sockets;
using System.Text;
using Prompty.Core;

namespace Prompty.Anthropic.Tests;

/// <summary>
/// Tests Anthropic model discovery protocol and pagination behavior.
/// </summary>
public class AnthropicModelDiscoveryTests
{
    [Fact]
    public void ModelLister_ImplementsGeneratedProtocol()
    {
        Assert.IsAssignableFrom<IModelLister>(new AnthropicModelLister());
    }

    [Fact]
    public async Task ListModelsAsync_FollowsPaginationAndPreservesProviderPayload()
    {
        using var socket = new TcpListener(IPAddress.Loopback, 0);
        socket.Start();
        var port = ((IPEndPoint)socket.LocalEndpoint).Port;
        socket.Stop();

        using var listener = new HttpListener();
        listener.Prefixes.Add($"http://localhost:{port}/");
        listener.Start();
        var requests = new List<(string Query, string? ApiKey, string? Version)>();
        var server = Task.Run(async () =>
        {
            for (var page = 0; page < 2; page++)
            {
                var context = await listener.GetContextAsync();
                requests.Add((
                    context.Request.Url?.Query ?? string.Empty,
                    context.Request.Headers["x-api-key"],
                    context.Request.Headers["anthropic-version"]));
                var body = page == 0
                    ? """
                      {
                        "data": [{"id":"claude-first","display_name":"Claude First","type":"model"}],
                        "has_more": true,
                        "last_id": "claude-first"
                      }
                      """
                    : """
                      {
                        "data": [{"id":"claude-second","created_at":"2025-01-01T00:00:00Z","type":"model"}],
                        "has_more": false,
                        "last_id": "claude-second"
                      }
                      """;
                var bytes = Encoding.UTF8.GetBytes(body);
                context.Response.ContentType = "application/json";
                context.Response.ContentLength64 = bytes.Length;
                await context.Response.OutputStream.WriteAsync(bytes);
                context.Response.Close();
            }
        });

        var models = await AnthropicModels.ListModelsAsync(
            new ApiKeyConnection
            {
                Endpoint = $"http://localhost:{port}",
                ApiKey = "test-anthropic-key",
            });

        await server;
        Assert.Equal(2, models.Count);
        Assert.Equal("Claude First", models[0].DisplayName);
        Assert.Equal("2025-01-01T00:00:00Z", models[1].AdditionalProperties!["created_at"].ToString());
        Assert.Equal("?limit=100", requests[0].Query);
        Assert.Equal("?limit=100&after_id=claude-first", requests[1].Query);
        Assert.All(requests, request =>
        {
            Assert.Equal("test-anthropic-key", request.ApiKey);
            Assert.Equal("2023-06-01", request.Version);
        });
    }
}
