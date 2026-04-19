// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;
using Prompty.OpenAI;

namespace Prompty.Providers.Tests.Integration;

/// <summary>
/// Integration tests — image generation against real OpenAI endpoints.
/// </summary>
[Trait("Category", "Integration")]
public class ImageTests : IntegrationTestBase
{
    private static List<Message> ImageMessages(string prompt = "A simple red circle on a white background") =>
    [
        new Message
        {
            Role = Role.User,
            Parts = [new TextPart { Value = prompt }],
        },
    ];

    [SkippableFact]
    public async Task OpenAI_ImageGeneration_ReturnsUrl()
    {
        var imageModel = GetEnvOrSkip("OPENAI_IMAGE_MODEL");
        var agent = MakeOpenAIAgent(apiType: "image", model: imageModel);
        var executor = new OpenAIExecutor();
        var processor = new OpenAIProcessor();

        var messages = ImageMessages();
        var response = await executor.ExecuteAsync(agent, messages);
        var result = await processor.ProcessAsync(agent, response);

        // ProcessImage returns a URL string or base64 string depending on model
        Assert.IsType<string>(result);
        var imageResult = (string)result;
        Assert.NotEmpty(imageResult);
    }

    [SkippableFact]
    public async Task OpenAI_ImageGeneration_Async()
    {
        var imageModel = GetEnvOrSkip("OPENAI_IMAGE_MODEL");
        var agent = MakeOpenAIAgent(apiType: "image", model: imageModel);
        var executor = new OpenAIExecutor();
        var processor = new OpenAIProcessor();

        var messages = ImageMessages("A blue square on a black background");
        var response = await executor.ExecuteAsync(agent, messages);
        var result = await processor.ProcessAsync(agent, response);

        Assert.IsType<string>(result);
        var imageResult = (string)result;
        Assert.NotEmpty(imageResult);
    }
}
