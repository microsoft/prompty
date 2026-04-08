// Copyright (c) Microsoft. All rights reserved.

using System.Reflection;
using Prompty.Core;

namespace Prompty.Core.Tests;

[Collection("InvokerRegistry")]
public class ToolAttributeTests : IDisposable
{
    public void Dispose() => ToolDispatch.ClearTools();
    // ─── Helper classes with [Tool] methods ───

    private class WeatherService
    {
        [Tool(Name = "get_weather", Description = "Get weather for a city")]
        public string GetWeather(string city, string units = "celsius")
        {
            return $"72°F in {city} ({units})";
        }

        [Tool]
        public string NoArgs()
        {
            return "no args result";
        }

        [Tool(Name = "add_numbers", Description = "Add two numbers")]
        public string AddNumbers(int a, int b)
        {
            return (a + b).ToString();
        }
    }

    private class TypeMappingService
    {
        [Tool]
        public string AllTypes(string s, int i, long l, float f, double d, decimal m, bool b)
        {
            return "ok";
        }

        [Tool]
        public string ArrayType(List<string> items)
        {
            return string.Join(",", items);
        }
    }

    // ─── BuildFromMethod ───

    [Fact]
    public void BuildFromMethod_CreatesCorrectFunctionTool()
    {
        var method = typeof(WeatherService).GetMethod("GetWeather")!;

        var tool = ToolAttribute.BuildFromMethod(method);

        Assert.Equal("get_weather", tool.Name);
        Assert.Equal("function", tool.Kind);
        Assert.Equal("Get weather for a city", tool.Description);
    }

    [Fact]
    public void BuildFromMethod_IncludesParameters()
    {
        var method = typeof(WeatherService).GetMethod("GetWeather")!;

        var tool = ToolAttribute.BuildFromMethod(method);

        Assert.Equal(2, tool.Parameters.Count);
        Assert.Equal("city", tool.Parameters[0].Name);
        Assert.Equal("string", tool.Parameters[0].Kind);
        Assert.Equal("units", tool.Parameters[1].Name);
        Assert.Equal("string", tool.Parameters[1].Kind);
    }

    [Fact]
    public void BuildFromMethod_DefaultValuesAreOptional()
    {
        var method = typeof(WeatherService).GetMethod("GetWeather")!;

        var tool = ToolAttribute.BuildFromMethod(method);

        // city is required (no default)
        Assert.True(tool.Parameters[0].Required);
        // units has a default value → not required
        Assert.False(tool.Parameters[1].Required);
        Assert.Equal("celsius", tool.Parameters[1].Default);
    }

    [Fact]
    public void BuildFromMethod_UsesMethodNameWhenNoOverride()
    {
        var method = typeof(WeatherService).GetMethod("NoArgs")!;

        var tool = ToolAttribute.BuildFromMethod(method);

        Assert.Equal("NoArgs", tool.Name);
        Assert.Equal("function", tool.Kind);
    }

    [Fact]
    public void BuildFromMethod_NoParameters_EmptyList()
    {
        var method = typeof(WeatherService).GetMethod("NoArgs")!;

        var tool = ToolAttribute.BuildFromMethod(method);

        Assert.Empty(tool.Parameters);
    }

    [Fact]
    public void BuildFromMethod_IntegerParameters()
    {
        var method = typeof(WeatherService).GetMethod("AddNumbers")!;

        var tool = ToolAttribute.BuildFromMethod(method);

        Assert.Equal(2, tool.Parameters.Count);
        Assert.Equal("integer", tool.Parameters[0].Kind);
        Assert.Equal("integer", tool.Parameters[1].Kind);
        Assert.True(tool.Parameters[0].Required);
        Assert.True(tool.Parameters[1].Required);
    }

    // ─── DiscoverTools ───

    [Fact]
    public void DiscoverTools_FindsAllToolMethods()
    {
        ToolDispatch.ClearTools();

        var service = new WeatherService();
        var tools = ToolAttribute.DiscoverTools(service);

        Assert.Equal(3, tools.Count);
        Assert.Contains("get_weather", tools.Keys);
        Assert.Contains("NoArgs", tools.Keys);
        Assert.Contains("add_numbers", tools.Keys);
    }

    [Fact]
    public void DiscoverTools_RegistersInGlobalRegistry()
    {
        ToolDispatch.ClearTools();

        var service = new WeatherService();
        ToolAttribute.DiscoverTools(service);

        Assert.NotNull(ToolDispatch.GetTool("get_weather"));
        Assert.NotNull(ToolDispatch.GetTool("NoArgs"));
        Assert.NotNull(ToolDispatch.GetTool("add_numbers"));
    }

    [Fact]
    public async Task DiscoverTools_HandlersReturnCorrectResults()
    {
        ToolDispatch.ClearTools();

        var service = new WeatherService();
        var tools = ToolAttribute.DiscoverTools(service);

        var result = await tools["get_weather"]("{\"city\": \"Seattle\"}");
        Assert.Contains("Seattle", result);

        var noArgsResult = await tools["NoArgs"]("{}");
        Assert.Equal("no args result", noArgsResult);
    }

    // ─── MapTypeToKind (tested indirectly via BuildFromMethod) ───

    [Fact]
    public void MapTypeToKind_StringMapsCorrectly()
    {
        var method = typeof(TypeMappingService).GetMethod("AllTypes")!;
        var tool = ToolAttribute.BuildFromMethod(method);

        Assert.Equal("string", tool.Parameters[0].Kind);   // string s
    }

    [Fact]
    public void MapTypeToKind_IntegerMapsCorrectly()
    {
        var method = typeof(TypeMappingService).GetMethod("AllTypes")!;
        var tool = ToolAttribute.BuildFromMethod(method);

        Assert.Equal("integer", tool.Parameters[1].Kind);  // int i
        Assert.Equal("integer", tool.Parameters[2].Kind);  // long l
    }

    [Fact]
    public void MapTypeToKind_FloatMapsCorrectly()
    {
        var method = typeof(TypeMappingService).GetMethod("AllTypes")!;
        var tool = ToolAttribute.BuildFromMethod(method);

        Assert.Equal("float", tool.Parameters[3].Kind);    // float f
        Assert.Equal("float", tool.Parameters[4].Kind);    // double d
        Assert.Equal("float", tool.Parameters[5].Kind);    // decimal m
    }

    [Fact]
    public void MapTypeToKind_BooleanMapsCorrectly()
    {
        var method = typeof(TypeMappingService).GetMethod("AllTypes")!;
        var tool = ToolAttribute.BuildFromMethod(method);

        Assert.Equal("boolean", tool.Parameters[6].Kind);  // bool b
    }

    [Fact]
    public void MapTypeToKind_ArrayMapsCorrectly()
    {
        var method = typeof(TypeMappingService).GetMethod("ArrayType")!;
        var tool = ToolAttribute.BuildFromMethod(method);

        Assert.Equal("array", tool.Parameters[0].Kind);    // List<string> items
    }

    // ─── BindTools ───

    private class EmptyToolService
    {
        // No [Tool] methods
    }

    [Fact]
    public void BindTools_MatchingDeclarations_ReturnsDictionary()
    {
        var agent = new Prompty
        {
            Name = "test",
            Model = new Model { Id = "gpt-4" },
            Tools = new List<Tool>
            {
                new FunctionTool { Name = "get_weather", Kind = "function" },
                new FunctionTool { Name = "NoArgs", Kind = "function" },
                new FunctionTool { Name = "add_numbers", Kind = "function" },
            }
        };

        var service = new WeatherService();
        var result = ToolAttribute.BindTools(agent, service);

        Assert.Contains("get_weather", result.Keys);
        Assert.Contains("NoArgs", result.Keys);
        Assert.Contains("add_numbers", result.Keys);
        Assert.Equal(3, result.Count);
    }

    [Fact]
    public void BindTools_HandlerNotDeclared_Throws()
    {
        var agent = new Prompty
        {
            Name = "test",
            Model = new Model { Id = "gpt-4" },
            Tools = new List<Tool>()
        };
        var service = new WeatherService();

        var ex = Assert.Throws<InvalidOperationException>(() =>
            ToolAttribute.BindTools(agent, service));
        Assert.Contains("get_weather", ex.Message);
        Assert.Contains("no matching", ex.Message);
    }

    [Fact]
    public void BindTools_IgnoresNonFunctionTools()
    {
        var agent = new Prompty
        {
            Name = "test",
            Model = new Model { Id = "gpt-4" },
            Tools = new List<Tool>
            {
                new FunctionTool { Name = "get_weather", Kind = "function" },
                new FunctionTool { Name = "NoArgs", Kind = "function" },
                new FunctionTool { Name = "add_numbers", Kind = "function" },
                new CustomTool { Name = "filesystem", Kind = "mcp" }
            }
        };

        var service = new WeatherService();
        var result = ToolAttribute.BindTools(agent, service);

        Assert.Equal(3, result.Count);
        Assert.DoesNotContain("filesystem", result.Keys);
    }

    [Fact]
    public void BindTools_DoesNotRegisterGlobally()
    {
        ToolDispatch.ClearTools();

        var agent = new Prompty
        {
            Name = "test",
            Model = new Model { Id = "gpt-4" },
            Tools = new List<Tool>
            {
                new FunctionTool { Name = "get_weather", Kind = "function" },
                new FunctionTool { Name = "NoArgs", Kind = "function" },
                new FunctionTool { Name = "add_numbers", Kind = "function" },
            }
        };

        var service = new WeatherService();
        ToolAttribute.BindTools(agent, service);

        Assert.Null(ToolDispatch.GetTool("get_weather"));
        Assert.Null(ToolDispatch.GetTool("NoArgs"));
        Assert.Null(ToolDispatch.GetTool("add_numbers"));
    }

    [Fact]
    public void BindTools_EmptyTools_ReturnsEmpty()
    {
        var agent = new Prompty
        {
            Name = "test",
            Model = new Model { Id = "gpt-4" }
        };
        var service = new EmptyToolService();
        var result = ToolAttribute.BindTools(agent, service);

        Assert.Empty(result);
    }

    [Fact]
    public async Task BindTools_HandlersAreCallable()
    {
        var agent = new Prompty
        {
            Name = "test",
            Model = new Model { Id = "gpt-4" },
            Tools = new List<Tool>
            {
                new FunctionTool { Name = "get_weather", Kind = "function" },
                new FunctionTool { Name = "NoArgs", Kind = "function" },
                new FunctionTool { Name = "add_numbers", Kind = "function" },
            }
        };

        var service = new WeatherService();
        var result = ToolAttribute.BindTools(agent, service);

        var weather = await result["get_weather"]("{\"city\": \"Seattle\"}");
        Assert.Contains("Seattle", weather);

        var noArgs = await result["NoArgs"]("{}");
        Assert.Equal("no args result", noArgs);

        var sum = await result["add_numbers"]("{\"a\": 3, \"b\": 5}");
        Assert.Equal("8", sum);
    }
}
