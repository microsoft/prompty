// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using OpenAI.Chat;
using Prompty.Core;
using Prompty.OpenAI;

namespace Prompty.Providers.Tests;

public class WireFormatTests
{
    // -----------------------------------------------------------------------
    // MessageToWire
    // -----------------------------------------------------------------------

    [Fact]
    public void MessageToWire_SystemMessage_ReturnsSystemChatMessage()
    {
        var msg = new Message
        {
            Role = Roles.System,
            Parts = [new TextPart { Value = "You are helpful" }],
        };

        var result = WireFormat.MessageToWire(msg);

        Assert.IsType<SystemChatMessage>(result);
    }

    [Fact]
    public void MessageToWire_DeveloperMessage_ReturnsDeveloperChatMessage()
    {
        var msg = new Message
        {
            Role = Roles.Developer,
            Parts = [new TextPart { Value = "Developer instructions" }],
        };

        var result = WireFormat.MessageToWire(msg);

        Assert.IsType<DeveloperChatMessage>(result);
    }

    [Fact]
    public void MessageToWire_UserTextMessage_ReturnsUserChatMessage()
    {
        var msg = new Message
        {
            Role = Roles.User,
            Parts = [new TextPart { Value = "Hello!" }],
        };

        var result = WireFormat.MessageToWire(msg);

        Assert.IsType<UserChatMessage>(result);
    }

    [Fact]
    public void MessageToWire_UserMultimodalMessage_ReturnsUserChatMessage()
    {
        var msg = new Message
        {
            Role = Roles.User,
            Parts =
            [
                new TextPart { Value = "What's in this image?" },
                new ImagePart { Source = "https://example.com/img.png", Detail = "high" },
            ],
        };

        var result = WireFormat.MessageToWire(msg);

        Assert.IsType<UserChatMessage>(result);
    }

    [Fact]
    public void MessageToWire_AssistantMessage_ReturnsAssistantChatMessage()
    {
        var msg = new Message
        {
            Role = Roles.Assistant,
            Parts = [new TextPart { Value = "Hello back!" }],
        };

        var result = WireFormat.MessageToWire(msg);

        Assert.IsType<AssistantChatMessage>(result);
    }

    [Fact]
    public void MessageToWire_AssistantWithToolCalls_PreservesToolCalls()
    {
        var msg = new Message
        {
            Role = Roles.Assistant,
            Parts = [new TextPart { Value = "" }],
            Metadata = new Dictionary<string, object>
            {
                ["tool_calls"] = new List<ToolCall>
                {
                    new() { Id = "call_1", Name = "get_weather", Arguments = """{"city":"NYC"}""" },
                },
            },
        };

        var result = WireFormat.MessageToWire(msg);

        var assistant = Assert.IsType<AssistantChatMessage>(result);
        Assert.Single(assistant.ToolCalls);
    }

    [Fact]
    public void MessageToWire_ToolMessage_ReturnsToolChatMessage()
    {
        var msg = new Message
        {
            Role = Roles.Tool,
            Parts = [new TextPart { Value = "72°F and sunny" }],
            Metadata = new Dictionary<string, object> { ["tool_call_id"] = "call_1" },
        };

        var result = WireFormat.MessageToWire(msg);

        Assert.IsType<ToolChatMessage>(result);
    }

    [Fact]
    public void MessageToWire_UnknownRole_DefaultsToUser()
    {
        var msg = new Message
        {
            Role = "custom_role",
            Parts = [new TextPart { Value = "test" }],
        };

        var result = WireFormat.MessageToWire(msg);

        Assert.IsType<UserChatMessage>(result);
    }

    // -----------------------------------------------------------------------
    // ToolsToWire
    // -----------------------------------------------------------------------

    [Fact]
    public void ToolsToWire_NullTools_ReturnsNull()
    {
        var agent = new Core.Prompty { Tools = null };
        Assert.Null(WireFormat.ToolsToWire(agent));
    }

    [Fact]
    public void ToolsToWire_EmptyTools_ReturnsNull()
    {
        var agent = new Core.Prompty { Tools = [] };
        Assert.Null(WireFormat.ToolsToWire(agent));
    }

    [Fact]
    public void ToolsToWire_FunctionTool_ProducesCorrectFormat()
    {
        var agent = new Core.Prompty
        {
            Tools =
            [
                new FunctionTool
                {
                    Name = "get_weather",
                    Description = "Get current weather",
                    Parameters = [new Property { Name = "city", Kind = "string", Required = true }],
                },
            ],
        };

        var result = WireFormat.ToolsToWire(agent);

        Assert.NotNull(result);
        Assert.Single(result);
    }

    [Fact]
    public void ToolsToWire_NonFunctionTool_Skipped()
    {
        var agent = new Core.Prompty
        {
            Tools =
            [
                new McpTool { Name = "mcp_tool" },
            ],
        };

        var result = WireFormat.ToolsToWire(agent);

        Assert.Null(result); // McpTool is not convertible to ChatTool
    }

    [Fact]
    public void ToolsToWire_StrictFunctionTool_SetsStrictFlag()
    {
        var agent = new Core.Prompty
        {
            Tools =
            [
                new FunctionTool
                {
                    Name = "strict_fn",
                    Description = "A strict function",
                    Parameters = [new Property { Name = "x", Kind = "string" }],
                    Strict = true,
                },
            ],
        };

        var result = WireFormat.ToolsToWire(agent);

        Assert.NotNull(result);
        Assert.Single(result);
    }

    // -----------------------------------------------------------------------
    // OutputSchemaToWire
    // -----------------------------------------------------------------------

    [Fact]
    public void OutputSchemaToWire_NullOutputs_ReturnsNull()
    {
        var agent = new Core.Prompty { Outputs = null };
        Assert.Null(WireFormat.OutputSchemaToWire(agent));
    }

    [Fact]
    public void OutputSchemaToWire_EmptyOutputs_ReturnsNull()
    {
        var agent = new Core.Prompty { Outputs = [] };
        Assert.Null(WireFormat.OutputSchemaToWire(agent));
    }

    [Fact]
    public void OutputSchemaToWire_WithOutputs_ReturnsJsonSchemaFormat()
    {
        var agent = new Core.Prompty
        {
            Outputs =
            [
                new Property { Name = "answer", Kind = "string", Required = true },
                new Property { Name = "confidence", Kind = "float" },
            ],
        };

        var result = WireFormat.OutputSchemaToWire(agent);

        Assert.NotNull(result);
        // ChatResponseFormat is the correct type — SDK wraps it
    }

    // -----------------------------------------------------------------------
    // BuildOptions
    // -----------------------------------------------------------------------

    [Fact]
    public void BuildOptions_NullModelOptions_ReturnsDefaults()
    {
        var agent = new Core.Prompty { Model = null! };

        var result = WireFormat.BuildOptions(agent);

        Assert.NotNull(result);
        Assert.Null(result.Temperature);
    }

    [Fact]
    public void BuildOptions_WithTemperature_SetsCorrectly()
    {
        var agent = new Core.Prompty
        {
            Model = new Model { Options = new ModelOptions { Temperature = 0.7f } },
        };

        var result = WireFormat.BuildOptions(agent);

        Assert.Equal(0.7f, result.Temperature);
    }

    [Fact]
    public void BuildOptions_WithMaxOutputTokens_SetsMaxOutputTokenCount()
    {
        var agent = new Core.Prompty
        {
            Model = new Model { Options = new ModelOptions { MaxOutputTokens = 1024 } },
        };

        var result = WireFormat.BuildOptions(agent);

        Assert.Equal(1024, result.MaxOutputTokenCount);
    }

    [Fact]
    public void BuildOptions_WithTopP_SetsCorrectly()
    {
        var agent = new Core.Prompty
        {
            Model = new Model { Options = new ModelOptions { TopP = 0.9f } },
        };

        var result = WireFormat.BuildOptions(agent);

        Assert.Equal(0.9f, result.TopP);
    }

    [Fact]
    public void BuildOptions_WithFrequencyPenalty_SetsCorrectly()
    {
        var agent = new Core.Prompty
        {
            Model = new Model { Options = new ModelOptions { FrequencyPenalty = 0.5f } },
        };

        var result = WireFormat.BuildOptions(agent);

        Assert.Equal(0.5f, result.FrequencyPenalty);
    }

    [Fact]
    public void BuildOptions_WithPresencePenalty_SetsCorrectly()
    {
        var agent = new Core.Prompty
        {
            Model = new Model { Options = new ModelOptions { PresencePenalty = 0.3f } },
        };

        var result = WireFormat.BuildOptions(agent);

        Assert.Equal(0.3f, result.PresencePenalty);
    }

    [Fact]
    public void BuildOptions_WithSeed_SetsCorrectly()
    {
        var agent = new Core.Prompty
        {
            Model = new Model { Options = new ModelOptions { Seed = 42 } },
        };

        var result = WireFormat.BuildOptions(agent);

        Assert.Equal(42L, result.Seed);
    }

    [Fact]
    public void BuildOptions_WithStopSequences_SetsCorrectly()
    {
        var agent = new Core.Prompty
        {
            Model = new Model { Options = new ModelOptions { StopSequences = ["END", "STOP"] } },
        };

        var result = WireFormat.BuildOptions(agent);

        Assert.Equal(2, result.StopSequences.Count);
        Assert.Contains("END", result.StopSequences);
        Assert.Contains("STOP", result.StopSequences);
    }

    [Fact]
    public void BuildOptions_WithTools_AddsToolsToOptions()
    {
        var agent = new Core.Prompty
        {
            Model = new Model { Options = new ModelOptions { Temperature = 0.5f } },
            Tools =
            [
                new FunctionTool
                {
                    Name = "search",
                    Description = "Search for things",
                    Parameters = [new Property { Name = "query", Kind = "string" }],
                },
            ],
        };

        var result = WireFormat.BuildOptions(agent);

        Assert.Single(result.Tools);
    }

    [Fact]
    public void BuildOptions_WithOutputSchema_SetsResponseFormat()
    {
        var agent = new Core.Prompty
        {
            Model = new Model { Options = new ModelOptions() },
            Outputs =
            [
                new Property { Name = "result", Kind = "string" },
            ],
        };

        var result = WireFormat.BuildOptions(agent);

        Assert.NotNull(result.ResponseFormat);
    }

    [Fact]
    public void BuildOptions_AllOptions_SetsEverything()
    {
        var agent = new Core.Prompty
        {
            Model = new Model
            {
                Options = new ModelOptions
                {
                    Temperature = 0.8f,
                    MaxOutputTokens = 2048,
                    TopP = 0.95f,
                    FrequencyPenalty = 0.1f,
                    PresencePenalty = 0.2f,
                    Seed = 123,
                    StopSequences = ["DONE"],
                },
            },
        };

        var result = WireFormat.BuildOptions(agent);

        Assert.Equal(0.8f, result.Temperature);
        Assert.Equal(2048, result.MaxOutputTokenCount);
        Assert.Equal(0.95f, result.TopP);
        Assert.Equal(0.1f, result.FrequencyPenalty);
        Assert.Equal(0.2f, result.PresencePenalty);
        Assert.Equal(123L, result.Seed);
        Assert.Single(result.StopSequences);
    }
}

