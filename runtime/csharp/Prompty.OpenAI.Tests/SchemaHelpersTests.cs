// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.OpenAI.Tests;

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
            new() { Name = null!, Kind = "string" },
            new() { Name = "valid", Kind = "string" },
        };

        var result = SchemaHelpers.PropertiesToJsonSchema(props);
        var properties = Assert.IsType<Dictionary<string, object?>>(result["properties"]);
        Assert.Single(properties);
        Assert.True(properties.ContainsKey("valid"));
    }

    [Fact]
    public void PropertiesToJsonSchema_ArrayOfObjects()
    {
        var itemProps = new List<Property>
        {
            new() { Name = "title", Kind = "string", Required = true },
            new() { Name = "difficulty", Kind = "integer" },
        };
        var props = new List<Property>
        {
            new ArrayProperty
            {
                Name = "encounters",
                Kind = "array",
                Description = "List of encounters",
                Items = new ObjectProperty
                {
                    Kind = "object",
                    Properties = itemProps,
                },
            },
        };

        var result = SchemaHelpers.PropertiesToJsonSchema(props, strict: true);
        var properties = Assert.IsType<Dictionary<string, object?>>(result["properties"]);
        var encounters = Assert.IsType<Dictionary<string, object?>>(properties["encounters"]);
        Assert.Equal(["array", "null"], Assert.IsType<List<string>>(encounters["type"]));

        var items = Assert.IsType<Dictionary<string, object?>>(encounters["items"]);
        Assert.Equal("object", items["type"]);
        var itemProperties = Assert.IsType<Dictionary<string, object?>>(items["properties"]);
        Assert.True(itemProperties.ContainsKey("title"));
        Assert.True(itemProperties.ContainsKey("difficulty"));

        var titleSchema = Assert.IsType<Dictionary<string, object?>>(itemProperties["title"]);
        Assert.Equal("string", titleSchema["type"]);

        var itemRequired = Assert.IsType<List<string>>(items["required"]);
        Assert.Contains("title", itemRequired);

        Assert.Equal(false, items["additionalProperties"]);
    }

    [Fact]
    public void PropertiesToJsonSchema_NestedObject()
    {
        var props = new List<Property>
        {
            new ObjectProperty
            {
                Name = "idea",
                Kind = "object",
                Properties = new List<Property>
                {
                    new() { Name = "name", Kind = "string" },
                    new() { Name = "description", Kind = "string" },
                },
            },
        };

        var result = SchemaHelpers.PropertiesToJsonSchema(props);
        var properties = Assert.IsType<Dictionary<string, object?>>(result["properties"]);
        var idea = Assert.IsType<Dictionary<string, object?>>(properties["idea"]);
        Assert.Equal("object", idea["type"]);

        var nestedProps = Assert.IsType<Dictionary<string, object?>>(idea["properties"]);
        Assert.True(nestedProps.ContainsKey("name"));
        Assert.True(nestedProps.ContainsKey("description"));
        Assert.Equal(false, idea["additionalProperties"]);
    }

    [Fact]
    public void PropertiesToJsonSchema_DeeplyNested()
    {
        var props = new List<Property>
        {
            new ArrayProperty
            {
                Name = "chapters",
                Kind = "array",
                Items = new ObjectProperty
                {
                    Kind = "object",
                    Properties = new List<Property>
                    {
                        new() { Name = "title", Kind = "string" },
                        new ArrayProperty
                        {
                            Name = "tags",
                            Kind = "array",
                            Items = new Property { Kind = "string" },
                        },
                    },
                },
            },
        };

        var result = SchemaHelpers.PropertiesToJsonSchema(props);
        var properties = Assert.IsType<Dictionary<string, object?>>(result["properties"]);
        var chapters = Assert.IsType<Dictionary<string, object?>>(properties["chapters"]);
        Assert.Equal("array", chapters["type"]);

        var chapterItems = Assert.IsType<Dictionary<string, object?>>(chapters["items"]);
        Assert.Equal("object", chapterItems["type"]);

        var chapterProps = Assert.IsType<Dictionary<string, object?>>(chapterItems["properties"]);
        var tags = Assert.IsType<Dictionary<string, object?>>(chapterProps["tags"]);
        Assert.Equal("array", tags["type"]);

        var tagItems = Assert.IsType<Dictionary<string, object?>>(tags["items"]);
        Assert.Equal("string", tagItems["type"]);
    }

    [Fact]
    public void PropertiesToJsonSchema_StrictMode_PreservesOptionalityAndNestedRequiredness()
    {
        var props = new List<Property>
        {
            new UnionProperty
            {
                Name = "set_row_visual",
                Nullable = true,
                AnyOf =
                [
                    new Property { Kind = "string" },
                    new Property { Kind = "boolean" },
                ],
            },
            new ObjectProperty
            {
                Name = "style",
                Required = true,
                Properties =
                [
                    new Property { Name = "border", Kind = "string", Required = false },
                    new Property { Name = "color", Kind = "string", Required = true },
                ],
            },
        };

        var result = SchemaHelpers.PropertiesToJsonSchema(props, strict: true, supportsOneOf: false);
        var properties = Assert.IsType<Dictionary<string, object?>>(result["properties"]);
        Assert.Equal(["set_row_visual", "style"], Assert.IsType<List<string>>(result["required"]));

        var visual = Assert.IsType<Dictionary<string, object?>>(properties["set_row_visual"]);
        var anyOf = Assert.IsAssignableFrom<IList<Dictionary<string, object?>>>(visual["anyOf"]);
        Assert.Equal(3, anyOf.Count);
        Assert.Equal("null", anyOf[^1]["type"]);

        var style = Assert.IsType<Dictionary<string, object?>>(properties["style"]);
        var nested = Assert.IsType<Dictionary<string, object?>>(style["properties"]);
        Assert.Equal(["border", "color"], Assert.IsType<List<string>>(style["required"]));
        Assert.Equal(["string", "null"], Assert.IsType<List<string>>(
            Assert.IsType<Dictionary<string, object?>>(nested["border"])["type"]));
        Assert.Equal("string", Assert.IsType<Dictionary<string, object?>>(nested["color"])["type"]);
    }

    [Fact]
    public void PropertiesToJsonSchema_NonStrictNestedRequiredness_UsesPropertyFlags()
    {
        var result = SchemaHelpers.PropertiesToJsonSchema(
        [
            new ObjectProperty
            {
                Name = "style",
                Properties =
                [
                    new Property { Name = "border", Kind = "string", Required = false },
                    new Property { Name = "color", Kind = "string", Required = true },
                ],
            },
        ]);

        var style = Assert.IsType<Dictionary<string, object?>>(
            Assert.IsType<Dictionary<string, object?>>(result["properties"])["style"]);
        Assert.Equal(["color"], Assert.IsType<List<string>>(style["required"]));
    }

    [Fact]
    public void PropertyToJsonSchema_NullableEnumAndCustomExtensionRemainValid()
    {
        var nullableEnum = SchemaHelpers.PropertyToJsonSchema(
            new Property { Kind = "string", Nullable = true, EnumValues = ["red", "green"] });
        Assert.Equal(["string", "null"], Assert.IsType<List<string>>(nullableEnum["type"]));
        Assert.Equal(["red", "green", null], Assert.IsType<List<object?>>(nullableEnum["enum"]));

        var nullableCustom = SchemaHelpers.PropertyToJsonSchema(
            new Property { Kind = "color-token", Nullable = true });
        Assert.False(nullableCustom.ContainsKey("type"));
        Assert.False(nullableCustom.ContainsKey("anyOf"));
        Assert.False(nullableCustom.ContainsKey("oneOf"));
    }

    [Fact]
    public void PropertyToJsonSchema_RejectsAmbiguousAndUnsupportedUnions()
    {
        Assert.Throws<InvalidOperationException>(() => SchemaHelpers.PropertyToJsonSchema(
            new UnionProperty { Kind = "union" }));
        Assert.Throws<InvalidOperationException>(() => SchemaHelpers.PropertyToJsonSchema(
            new UnionProperty
            {
                Kind = "union",
                OneOf = [new Property { Kind = "string" }],
                AnyOf = [new Property { Kind = "integer" }],
            }));
        Assert.Throws<InvalidOperationException>(() => SchemaHelpers.PropertyToJsonSchema(
            new UnionProperty
            {
                Kind = "union",
                OneOf = [new Property { Kind = "string" }],
            },
            supportsOneOf: false));
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
