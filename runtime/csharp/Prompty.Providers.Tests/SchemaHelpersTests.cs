// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Providers.Tests;

public class SchemaHelpersTests
{
    [Fact]
    public void PropertiesToJsonSchema_NullProperties_ReturnsEmptyObjectSchema()
    {
        var result = SchemaHelpers.PropertiesToJsonSchema(null);
        Assert.Equal("object", result["type"]);
        Assert.False(result.ContainsKey("properties"));
    }

    [Fact]
    public void PropertiesToJsonSchema_EmptyProperties_ReturnsEmptyObjectSchema()
    {
        var result = SchemaHelpers.PropertiesToJsonSchema([]);
        Assert.Equal("object", result["type"]);
        Assert.False(result.ContainsKey("properties"));
    }

    [Fact]
    public void PropertiesToJsonSchema_SingleStringProperty()
    {
        var props = new List<Property>
        {
            new() { Name = "city", Kind = "string", Description = "City name" },
        };

        var result = SchemaHelpers.PropertiesToJsonSchema(props);

        Assert.Equal("object", result["type"]);
        var properties = Assert.IsType<Dictionary<string, object?>>(result["properties"]);
        Assert.Single(properties);

        var citySchema = Assert.IsType<Dictionary<string, object?>>(properties["city"]);
        Assert.Equal("string", citySchema["type"]);
        Assert.Equal("City name", citySchema["description"]);
    }

    [Fact]
    public void PropertiesToJsonSchema_RequiredProperties()
    {
        var props = new List<Property>
        {
            new() { Name = "name", Kind = "string", Required = true },
            new() { Name = "age", Kind = "integer", Required = false },
        };

        var result = SchemaHelpers.PropertiesToJsonSchema(props);

        var required = Assert.IsType<List<string>>(result["required"]);
        Assert.Single(required);
        Assert.Contains("name", required);
    }

    [Fact]
    public void PropertiesToJsonSchema_StrictMode_AddsAdditionalProperties()
    {
        var props = new List<Property>
        {
            new() { Name = "x", Kind = "string" },
        };

        var result = SchemaHelpers.PropertiesToJsonSchema(props, strict: true);

        Assert.Equal(false, result["additionalProperties"]);
    }

    [Fact]
    public void PropertiesToJsonSchema_NonStrictMode_NoAdditionalProperties()
    {
        var props = new List<Property>
        {
            new() { Name = "x", Kind = "string" },
        };

        var result = SchemaHelpers.PropertiesToJsonSchema(props, strict: false);

        Assert.False(result.ContainsKey("additionalProperties"));
    }

    [Fact]
    public void PropertiesToJsonSchema_EnumValues()
    {
        var props = new List<Property>
        {
            new()
            {
                Name = "color",
                Kind = "string",
                EnumValues = ["red", "green", "blue"],
            },
        };

        var result = SchemaHelpers.PropertiesToJsonSchema(props);
        var properties = Assert.IsType<Dictionary<string, object?>>(result["properties"]);
        var colorSchema = Assert.IsType<Dictionary<string, object?>>(properties["color"]);
        var enumValues = Assert.IsAssignableFrom<IList<object>>(colorSchema["enum"]);
        Assert.Equal(3, enumValues.Count);
        Assert.Contains("red", enumValues.Select(v => v?.ToString()));
    }

    [Fact]
    public void PropertiesToJsonSchema_MultipleProperties()
    {
        var props = new List<Property>
        {
            new() { Name = "city", Kind = "string", Required = true },
            new() { Name = "temperature", Kind = "float" },
            new() { Name = "count", Kind = "integer", Required = true },
            new() { Name = "enabled", Kind = "boolean" },
        };

        var result = SchemaHelpers.PropertiesToJsonSchema(props);

        var properties = Assert.IsType<Dictionary<string, object?>>(result["properties"]);
        Assert.Equal(4, properties.Count);

        var required = Assert.IsType<List<string>>(result["required"]);
        Assert.Equal(2, required.Count);
        Assert.Contains("city", required);
        Assert.Contains("count", required);
    }

    [Fact]
    public void PropertiesToJsonSchema_SkipsNullNames()
    {
        var props = new List<Property>
        {
            new() { Name = null, Kind = "string" },
            new() { Name = "valid", Kind = "string" },
        };

        var result = SchemaHelpers.PropertiesToJsonSchema(props);
        var properties = Assert.IsType<Dictionary<string, object?>>(result["properties"]);
        Assert.Single(properties);
        Assert.True(properties.ContainsKey("valid"));
    }

    [Theory]
    [InlineData("string", "string")]
    [InlineData("integer", "integer")]
    [InlineData("float", "number")]
    [InlineData("number", "number")]
    [InlineData("boolean", "boolean")]
    [InlineData("array", "array")]
    [InlineData("object", "object")]
    [InlineData(null, "string")]
    [InlineData("unknown", "string")]
    public void MapKindToJsonType_MapsCorrectly(string? kind, string expected)
    {
        Assert.Equal(expected, SchemaHelpers.MapKindToJsonType(kind));
    }
}
