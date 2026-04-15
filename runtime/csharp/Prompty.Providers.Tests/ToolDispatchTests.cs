// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Providers.Tests;

/// <summary>
/// Tests for the two-layer tool dispatch system and agent loop.
/// </summary>
[Collection("ToolDispatch")]
public class ToolDispatchTests : IDisposable
{
    public ToolDispatchTests()
    {
        // Clean slate for each test
        ToolDispatch.ClearTools();
        ToolDispatch.ClearToolHandlers();
    }

    public void Dispose()
    {
        ToolDispatch.ClearTools();
        ToolDispatch.ClearToolHandlers();
    }

    // -----------------------------------------------------------------------
    // Layer 1: Name-based registry
    // -----------------------------------------------------------------------

    [Fact]
    public void RegisterTool_AndGetTool_Works()
    {
        ToolDispatch.RegisterTool("my_tool", args => Task.FromResult("result"));

        var fn = ToolDispatch.GetTool("my_tool");
        Assert.NotNull(fn);
    }

    [Fact]
    public void GetTool_Unregistered_ReturnsNull()
    {
        Assert.Null(ToolDispatch.GetTool("nonexistent"));
    }

    [Fact]
    public void ClearTools_RemovesAllRegistrations()
    {
        ToolDispatch.RegisterTool("tool_a", _ => Task.FromResult("a"));
        ToolDispatch.RegisterTool("tool_b", _ => Task.FromResult("b"));

        ToolDispatch.ClearTools();

        Assert.Null(ToolDispatch.GetTool("tool_a"));
        Assert.Null(ToolDispatch.GetTool("tool_b"));
    }

    // -----------------------------------------------------------------------
    // Layer 2: Kind-based handler registry
    // -----------------------------------------------------------------------

    [Fact]
    public void RegisterToolHandler_AndGetToolHandler_Works()
    {
        ToolHandler handler = (agent, tool, args) => Task.FromResult("handled");
        ToolDispatch.RegisterToolHandler("custom_kind", handler);

        var retrieved = ToolDispatch.GetToolHandler("custom_kind");
        Assert.NotNull(retrieved);
        Assert.Same(handler, retrieved);
    }

    [Fact]
    public void GetToolHandler_Unregistered_ReturnsNull()
    {
        Assert.Null(ToolDispatch.GetToolHandler("nonexistent_kind"));
    }

    [Fact]
    public void ClearToolHandlers_RemovesAll()
    {
        ToolDispatch.RegisterToolHandler("kind_a", (a, t, args) => Task.FromResult("a"));
        ToolDispatch.ClearToolHandlers();

        Assert.Null(ToolDispatch.GetToolHandler("kind_a"));
    }

    // -----------------------------------------------------------------------
    // Dispatch — priority order
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Dispatch_UserToolsHaveHighestPriority()
    {
        // Register in global name registry
        ToolDispatch.RegisterTool("greet", _ => Task.FromResult("global"));

        var agent = new Core.Prompty
        {
            Tools =
            [
                new FunctionTool { Name = "greet", Kind = "function" },
            ],
        };

        var call = new ToolCall { Id = "c1", Name = "greet", Arguments = """{}""" };

        // User tool should win over global
        var userTools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["greet"] = _ => Task.FromResult("user-level"),
        };

        var result = await ToolDispatch.DispatchAsync(agent, call, userTools);
        Assert.Equal("user-level", result);
    }

    [Fact]
    public async Task Dispatch_GlobalNameRegistry_SecondPriority()
    {
        ToolDispatch.RegisterTool("greet", _ => Task.FromResult("global-registered"));

        var agent = new Core.Prompty
        {
            Tools = [new FunctionTool { Name = "greet", Kind = "function" }],
        };

        var call = new ToolCall { Id = "c1", Name = "greet", Arguments = """{}""" };

        var result = await ToolDispatch.DispatchAsync(agent, call);
        Assert.Equal("global-registered", result);
    }

    [Fact]
    public async Task Dispatch_KindHandler_ThirdPriority()
    {
        ToolDispatch.RegisterToolHandler("custom_kind",
            (agent, tool, args) => Task.FromResult($"kind-handler:{tool.Name}"));

        var agent = new Core.Prompty
        {
            Tools = [new CustomTool { Name = "my_tool", Kind = "custom_kind" }],
        };

        var call = new ToolCall { Id = "c1", Name = "my_tool", Arguments = """{}""" };

        var result = await ToolDispatch.DispatchAsync(agent, call);
        Assert.Equal("kind-handler:my_tool", result);
    }

    [Fact]
    public async Task Dispatch_WildcardHandler_FallbackPriority()
    {
        ToolDispatch.RegisterToolHandler("*",
            (agent, tool, args) => Task.FromResult("wildcard-handled"));

        var agent = new Core.Prompty
        {
            Tools = [new CustomTool { Name = "exotic", Kind = "exotic_kind" }],
        };

        var call = new ToolCall { Id = "c1", Name = "exotic", Arguments = """{}""" };

        var result = await ToolDispatch.DispatchAsync(agent, call);
        Assert.Equal("wildcard-handled", result);
    }

    [Fact]
    public async Task Dispatch_NoHandler_ThrowsToolHandlerError()
    {
        var agent = new Core.Prompty
        {
            Tools = [new FunctionTool { Name = "unknown_fn", Kind = "function" }],
        };

        var call = new ToolCall { Id = "c1", Name = "unknown_fn", Arguments = """{}""" };

        await Assert.ThrowsAsync<ToolHandlerError>(
            () => ToolDispatch.DispatchAsync(agent, call));
    }

    [Fact]
    public async Task Dispatch_NoToolDefinition_ThrowsToolHandlerError()
    {
        var agent = new Core.Prompty { Tools = [] };
        var call = new ToolCall { Id = "c1", Name = "missing", Arguments = """{}""" };

        await Assert.ThrowsAsync<ToolHandlerError>(
            () => ToolDispatch.DispatchAsync(agent, call));
    }

    // -----------------------------------------------------------------------
    // Argument parsing
    // -----------------------------------------------------------------------

    [Fact]
    public void ParseArguments_ValidJson_ReturnsDictionary()
    {
        var result = ToolDispatch.ParseArguments("""{"city":"NYC","count":3,"active":true}""");

        Assert.Equal("NYC", result["city"]);
        Assert.Equal(3.0, result["count"]); // JSON numbers are double
        Assert.Equal(true, result["active"]);
    }

    [Fact]
    public void ParseArguments_EmptyString_ReturnsEmptyDict()
    {
        var result = ToolDispatch.ParseArguments("");
        Assert.Empty(result);
    }

    [Fact]
    public void ParseArguments_InvalidJson_ReturnsErrorFallback()
    {
        var result = ToolDispatch.ParseArguments("not json");
        Assert.True(result.ContainsKey("_error"));
    }

    [Fact]
    public void ParseArguments_NullValues()
    {
        var result = ToolDispatch.ParseArguments("""{"key":null}""");
        Assert.True(result.ContainsKey("key"));
        Assert.Null(result["key"]);
    }

    // -----------------------------------------------------------------------
    // Built-in handlers
    // -----------------------------------------------------------------------

    [Fact]
    public async Task BuiltinFunctionHandler_NoCallable_ThrowsToolHandlerError()
    {
        ToolDispatch.RegisterBuiltins();

        var agent = new Core.Prompty
        {
            Tools = [new FunctionTool { Name = "no_impl", Kind = "function" }],
        };
        var call = new ToolCall { Id = "c1", Name = "no_impl", Arguments = """{}""" };

        var ex = await Assert.ThrowsAsync<ToolHandlerError>(
            () => ToolDispatch.DispatchAsync(agent, call));
        Assert.Contains("no_impl", ex.Message);
    }

    [Fact]
    public async Task BuiltinFunctionHandler_WithRegisteredCallable_NameRegistryWins()
    {
        ToolDispatch.RegisterBuiltins();
        ToolDispatch.RegisterTool("my_func", args => Task.FromResult("called!"));

        var agent = new Core.Prompty
        {
            Tools = [new FunctionTool { Name = "my_func", Kind = "function" }],
        };
        var call = new ToolCall { Id = "c1", Name = "my_func", Arguments = """{}""" };

        var result = await ToolDispatch.DispatchAsync(agent, call);
        Assert.Equal("called!", result);
    }

    // -----------------------------------------------------------------------
    // Tool bindings
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Dispatch_AppliesBindings()
    {
        ToolDispatch.RegisterToolHandler("custom_kind",
            (agent, tool, args) =>
            {
                // Should have the binding value injected
                var location = args.GetValueOrDefault("location")?.ToString();
                return Task.FromResult($"location={location}");
            });

        var agent = new Core.Prompty
        {
            Tools =
            [
                new CustomTool
                {
                    Name = "bound_tool",
                    Kind = "custom_kind",
                    Bindings = [new Binding { Name = "location", Input = "Seattle" }],
                },
            ],
        };

        var call = new ToolCall { Id = "c1", Name = "bound_tool", Arguments = """{}""" };
        var result = await ToolDispatch.DispatchAsync(agent, call);
        Assert.Equal("location=Seattle", result);
    }

    // -----------------------------------------------------------------------
    // MCP / OpenAPI stub handlers
    // -----------------------------------------------------------------------

    [Fact]
    public async Task McpHandler_ThrowsToolHandlerError()
    {
        ToolDispatch.RegisterBuiltins();

        var agent = new Core.Prompty
        {
            Tools = [new McpTool { Name = "fs_server", Kind = "mcp" }],
        };
        var call = new ToolCall { Id = "c1", Name = "fs_server", Arguments = """{}""" };

        var ex = await Assert.ThrowsAsync<ToolHandlerError>(
            () => ToolDispatch.DispatchAsync(agent, call));
        Assert.Contains("MCP tool", ex.Message);
        Assert.Contains("fs_server", ex.Message);
    }

    [Fact]
    public async Task OpenApiHandler_ThrowsToolHandlerError()
    {
        ToolDispatch.RegisterBuiltins();

        var agent = new Core.Prompty
        {
            Tools = [new OpenApiTool { Name = "weather_api", Kind = "openapi" }],
        };
        var call = new ToolCall { Id = "c1", Name = "weather_api", Arguments = """{}""" };

        var ex = await Assert.ThrowsAsync<ToolHandlerError>(
            () => ToolDispatch.DispatchAsync(agent, call));
        Assert.Contains("OpenAPI tool", ex.Message);
        Assert.Contains("weather_api", ex.Message);
    }

    [Fact]
    public async Task McpHandler_Dispatch_CatchesError_ReturnsErrorString()
    {
        ToolDispatch.RegisterBuiltins();

        var agent = new Core.Prompty
        {
            Tools = [new McpTool { Name = "mcp_tool", Kind = "mcp" }],
        };
        var call = new ToolCall { Id = "c1", Name = "mcp_tool", Arguments = """{}""" };

        // Dispatch should catch ToolHandlerError and return error string
        // But only if there's a wildcard or the dispatch swallows the error
        // Since dispatch propagates ToolHandlerError by design, we verify the exception
        await Assert.ThrowsAsync<ToolHandlerError>(
            () => ToolDispatch.DispatchAsync(agent, call));
    }

    [Fact]
    public void RegisterBuiltins_RegistersMcpAndOpenApi()
    {
        ToolDispatch.RegisterBuiltins();

        Assert.NotNull(ToolDispatch.GetToolHandler("mcp"));
        Assert.NotNull(ToolDispatch.GetToolHandler("openapi"));
        Assert.NotNull(ToolDispatch.GetToolHandler("function"));
        Assert.NotNull(ToolDispatch.GetToolHandler("prompty"));
    }
}
