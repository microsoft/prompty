// Copyright (c) Microsoft. All rights reserved.

using System.Net;
using System.Net.Sockets;
using Prompty.Core;

namespace Prompty.Foundry.Tests;

public class FoundryModelDiscoveryTests
{
    [Theory]
    [InlineData(
        "https://seth-foundry-dev.services.ai.azure.com/api/projects/dev-models",
        "https://seth-foundry-dev.openai.azure.com/openai/v1")]
    [InlineData(
        "https://seth-foundry-dev.openai.azure.com/openai/v1",
        "https://seth-foundry-dev.openai.azure.com/openai/v1")]
    public void FoundryExecutor_ConvertsProjectEndpointToOpenAIBaseUrl(string input, string expected)
    {
        var method = typeof(FoundryExecutor).GetMethod(
            "ToOpenAIBaseUrl",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);

        Assert.NotNull(method);
        Assert.Equal(expected, method.Invoke(null, [input]));
    }

    [Fact]
    public async Task ListModelsAsync_ReferenceDeploymentClient_ReturnsDeploymentsWithCapabilities()
    {
        using var socket = new TcpListener(IPAddress.Loopback, 0);
        socket.Start();
        var port = ((IPEndPoint)socket.LocalEndpoint).Port;
        socket.Stop();

        using var listener = new HttpListener();
        listener.Prefixes.Add($"http://localhost:{port}/");
        listener.Start();
        var server = Task.Run(async () =>
        {
            var context = await listener.GetContextAsync();
            Assert.Equal("/api/projects/demo/deployments", context.Request.Url?.AbsolutePath);
            Assert.Equal("api-version=v1", context.Request.Url?.Query.TrimStart('?'));
            Assert.Equal("Bearer test-token", context.Request.Headers["Authorization"]);
            var body = """
            {
              "value": [
                {
                  "name": "chat-prod",
                  "properties": {
                    "model": { "name": "gpt-4o", "publisher": "Microsoft" },
                    "capabilities": {
                      "maxContextLength": 128000,
                      "inputModalities": ["text", "image"],
                      "outputModalities": "text, json"
                    }
                  }
                }
              ]
            }
            """;
            var bytes = System.Text.Encoding.UTF8.GetBytes(body);
            context.Response.ContentType = "application/json";
            context.Response.ContentLength64 = bytes.Length;
            await context.Response.OutputStream.WriteAsync(bytes);
            context.Response.Close();
        });

        ConnectionRegistry.Register(
            "foundry-project",
            new FoundryModels.FoundryDeploymentClient(
                $"http://localhost:{port}/api/projects/demo",
                _ => Task.FromResult("test-token")));

        var models = await FoundryModels.ListModelsAsync(
            new ReferenceConnection { Name = "foundry-project" });

        await server;
        ConnectionRegistry.Clear();
        Assert.Single(models);
        var model = models[0];
        Assert.Equal("chat-prod", model.Id);
        Assert.Equal("gpt-4o", model.DisplayName);
        Assert.Equal("Microsoft", model.OwnedBy);
        Assert.Equal(128000, model.ContextWindow);
        Assert.Equal(new[] { "text", "image" }, model.InputModalities);
        Assert.Equal(new[] { "text", "json" }, model.OutputModalities);
        Assert.NotNull(model.AdditionalProperties);
    }
}
