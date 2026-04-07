// Copyright (c) Microsoft. All rights reserved.

#pragma warning disable OPENAI001 // Responses API is in preview

using System.Text.Json;
using OpenAI.Responses;
using Prompty.Core;
using Prompty.OpenAI;

namespace Prompty.Providers.Tests;

/// <summary>
/// Tests for Responses API wire format, message conversion, tool conversion,
/// structured output, and response processing.
/// </summary>
public class ResponsesApiTests
{
    // -----------------------------------------------------------------------
    // BuildResponsesOptions — basic construction
    // -----------------------------------------------------------------------

    [Fact]
    public void BuildResponsesOptions_SetsModel()
    {
        var agent = TestHelpers.CreateAgent(apiType: "responses");
        var messages = new List<Message>
        {
            TestHelpers.CreateMessage(Roles.User, "Hello"),
        };

        var options = WireFormat.BuildResponsesOptions("gpt-4", agent, messages);

        Assert.Equal("gpt-4", options.Model);
    }

    [Fact]
    public void BuildResponsesOptions_SystemMessagesBecomesInstructions()
    {
        var agent = TestHelpers.CreateAgent(apiType: "responses");
        var messages = new List<Message>
        {
            TestHelpers.CreateMessage(Roles.System, "You are helpful"),
            TestHelpers.CreateMessage(Roles.User, "Hello"),
        };

        var options = WireFormat.BuildResponsesOptions("gpt-4", agent, messages);

        Assert.Equal("You are helpful", options.Instructions);
        // System messages should NOT appear in InputItems
        Assert.Single(options.InputItems);
    }

    [Fact]
    public void BuildResponsesOptions_DeveloperMessageBecomesInstructions()
    {
        var agent = TestHelpers.CreateAgent(apiType: "responses");
        var messages = new List<Message>
        {
            TestHelpers.CreateMessage(Roles.Developer, "Developer guidance"),
            TestHelpers.CreateMessage(Roles.User, "Hello"),
        };

        var options = WireFormat.BuildResponsesOptions("gpt-4", agent, messages);

        Assert.Equal("Developer guidance", options.Instructions);
    }

    [Fact]
    public void BuildResponsesOptions_MultipleSystemMessagesJoined()
    {
        var agent = TestHelpers.CreateAgent(apiType: "responses");
        var messages = new List<Message>
        {
            TestHelpers.CreateMessage(Roles.System, "First instruction"),
            TestHelpers.CreateMessage(Roles.Developer, "Second instruction"),
            TestHelpers.CreateMessage(Roles.User, "Hello"),
        };

        var options = WireFormat.BuildResponsesOptions("gpt-4", agent, messages);

        Assert.Equal("First instruction\n\nSecond instruction", options.Instructions);
    }

    [Fact]
    public void BuildResponsesOptions_MapsModelOptions()
    {
        var agent = TestHelpers.CreateAgent(
            apiType: "responses",
            options: new ModelOptions
            {
                Temperature = 0.7f,
                MaxOutputTokens = 500,
                TopP = 0.9f,
            });
        var messages = new List<Message>
        {
            TestHelpers.CreateMessage(Roles.User, "Hello"),
        };

        var options = WireFormat.BuildResponsesOptions("gpt-4", agent, messages);

        Assert.Equal(0.7f, options.Temperature);
        Assert.Equal(500, options.MaxOutputTokenCount);
        Assert.Equal(0.9f, options.TopP);
    }

    // -----------------------------------------------------------------------
    // MessageToResponsesInput — role conversion
    // -----------------------------------------------------------------------

    [Fact]
    public void MessageToResponsesInput_UserMessage_CreatesUserItem()
    {
        var msg = TestHelpers.CreateMessage(Roles.User, "Hello world");

        var item = WireFormat.MessageToResponsesInput(msg);

        Assert.NotNull(item);
        // UserMessageResponseItem is created via factory
        Assert.IsAssignableFrom<ResponseItem>(item);
    }

    [Fact]
    public void MessageToResponsesInput_AssistantMessage_CreatesAssistantItem()
    {
        var msg = TestHelpers.CreateMessage(Roles.Assistant, "I can help");

        var item = WireFormat.MessageToResponsesInput(msg);

        Assert.NotNull(item);
        Assert.IsAssignableFrom<ResponseItem>(item);
    }

    [Fact]
    public void MessageToResponsesInput_ToolResult_CreatesFunctionCallOutputItem()
    {
        var msg = TestHelpers.CreateToolMessage("call_123", "The weather is 72F");

        var item = WireFormat.MessageToResponsesInput(msg);

        Assert.NotNull(item);
        Assert.IsType<FunctionCallOutputResponseItem>(item);
        var output = (FunctionCallOutputResponseItem)item;
        Assert.Equal("call_123", output.CallId);
        Assert.Equal("The weather is 72F", output.FunctionOutput);
    }

    [Fact]
    public void MessageToResponsesInput_SystemMessage_TreatedAsUser()
    {
        // System messages should be handled by BuildResponsesOptions (as Instructions),
        // but if MessageToResponsesInput is called directly with a system message,
        // it falls through to the default (user)
        var msg = TestHelpers.CreateMessage(Roles.System, "System text");

        var item = WireFormat.MessageToResponsesInput(msg);

        Assert.NotNull(item);
        Assert.IsAssignableFrom<ResponseItem>(item);
    }

    [Fact]
    public void MessageToResponsesInput_FunctionCallPassthrough_ReturnsStoredItem()
    {
        var storedItem = ResponseItem.CreateFunctionCallOutputItem("call_abc", "result");
        var msg = new Message
        {
            Role = Roles.Assistant,
            Parts = [new TextPart { Value = "" }],
            Metadata = new Dictionary<string, object?>
            {
                ["responses_function_call"] = storedItem,
            },
        };

        var item = WireFormat.MessageToResponsesInput(msg);

        Assert.Same(storedItem, item);
    }

    // -----------------------------------------------------------------------
    // ToolsToResponsesWire — tool conversion
    // -----------------------------------------------------------------------

    [Fact]
    public void ToolsToResponsesWire_FunctionTool_CreatesResponseTool()
    {
        var agent = TestHelpers.CreateAgent(
            tools:
            [
                TestHelpers.CreateFunctionTool(
                    "get_weather",
                    "Get weather for a city",
                    [
                        new Property
                        {
                            Name = "city",
                            Kind = "string",
                            Description = "City name",
                            Required = true,
                        },
                    ]),
            ]);

        var tools = WireFormat.ToolsToResponsesWire(agent);

        Assert.NotNull(tools);
        Assert.Single(tools);
    }

    [Fact]
    public void ToolsToResponsesWire_NoTools_ReturnsNull()
    {
        var agent = TestHelpers.CreateAgent();

        var tools = WireFormat.ToolsToResponsesWire(agent);

        Assert.Null(tools);
    }

    [Fact]
    public void ToolsToResponsesWire_StrictTool_IncludesStrictFlag()
    {
        var agent = TestHelpers.CreateAgent(
            tools:
            [
                TestHelpers.CreateFunctionTool(
                    "strict_tool",
                    "A strict tool",
                    [
                        new Property
                        {
                            Name = "input",
                            Kind = "string",
                            Required = true,
                        },
                    ],
                    strict: true),
            ]);

        var tools = WireFormat.ToolsToResponsesWire(agent);

        Assert.NotNull(tools);
        Assert.Single(tools);
    }

    // -----------------------------------------------------------------------
    // Structured output in Responses API
    // -----------------------------------------------------------------------

    [Fact]
    public void BuildResponsesOptions_WithOutputSchema_SetsTextFormat()
    {
        var agent = TestHelpers.CreateAgent(
            apiType: "responses",
            outputs:
            [
                new Property { Name = "name", Kind = "string" },
                new Property { Name = "age", Kind = "integer" },
            ]);
        var messages = new List<Message>
        {
            TestHelpers.CreateMessage(Roles.User, "Extract info"),
        };

        var options = WireFormat.BuildResponsesOptions("gpt-4", agent, messages);

        Assert.NotNull(options.TextOptions);
        Assert.NotNull(options.TextOptions.TextFormat);
    }

    [Fact]
    public void BuildResponsesOptions_WithoutOutputSchema_NoTextFormat()
    {
        var agent = TestHelpers.CreateAgent(apiType: "responses");
        var messages = new List<Message>
        {
            TestHelpers.CreateMessage(Roles.User, "Hello"),
        };

        var options = WireFormat.BuildResponsesOptions("gpt-4", agent, messages);

        // TextOptions should be null if no output schema
        Assert.Null(options.TextOptions);
    }

    // -----------------------------------------------------------------------
    // BuildResponsesOptions — tools integration
    // -----------------------------------------------------------------------

    [Fact]
    public void BuildResponsesOptions_WithTools_AddsToOptions()
    {
        var agent = TestHelpers.CreateAgent(
            apiType: "responses",
            tools:
            [
                TestHelpers.CreateFunctionTool("search", "Search the web"),
            ]);
        var messages = new List<Message>
        {
            TestHelpers.CreateMessage(Roles.User, "Search for something"),
        };

        var options = WireFormat.BuildResponsesOptions("gpt-4", agent, messages);

        Assert.Single(options.Tools);
    }

    // -----------------------------------------------------------------------
    // OpenAIProcessor — ProcessResponses
    // -----------------------------------------------------------------------
    // Note: ResponseResult cannot be easily mocked since it's an OpenAI SDK class.
    // The processor dispatch is tested via the type-switch pattern.
    // We verify the processor can handle the dispatch routing.

    [Fact]
    public async Task Processor_HandlesPromptyStream()
    {
        // PromptyStream dispatch should work regardless of apiType
        var processor = new OpenAIProcessor();
        var agent = TestHelpers.CreateAgent(apiType: "responses");

        async IAsyncEnumerable<object> EmptyStream()
        {
            await Task.CompletedTask;
            yield break;
        }

        var stream = new PromptyStream(EmptyStream());
        var result = await processor.ProcessAsync(agent, stream);

        Assert.IsType<ProcessedStream>(result);
    }

    [Fact]
    public async Task Processor_UnknownType_PassesThrough()
    {
        var processor = new OpenAIProcessor();
        var agent = TestHelpers.CreateAgent(apiType: "responses");
        var input = "raw string result";

        var result = await processor.ProcessAsync(agent, input);

        Assert.Equal("raw string result", result);
    }
}
