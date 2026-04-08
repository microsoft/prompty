// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using Prompty.Core;

namespace Prompty.Core.Tests;

public class StructuredResultTests
{
    [Fact]
    public void IsDictionary()
    {
        var sr = new StructuredResult(
            new Dictionary<string, object?> { ["name"] = "Jane" },
            """{"name":"Jane"}""");
        Assert.IsAssignableFrom<IDictionary<string, object?>>(sr);
        Assert.Equal("Jane", sr["name"]);
    }

    [Fact]
    public void RawJsonPreserved()
    {
        var raw = """{"temperature":72,"unit":"F"}""";
        var sr = StructuredResult.FromJson(raw);
        Assert.Equal(raw, sr.RawJson);
    }

    [Fact]
    public void FromJsonParsesNested()
    {
        var raw = """{"user":{"name":"Jane","age":30},"tags":["a","b"]}""";
        var sr = StructuredResult.FromJson(raw);
        Assert.IsType<Dictionary<string, object?>>(sr["user"]);
        var user = (Dictionary<string, object?>)sr["user"]!;
        Assert.Equal("Jane", user["name"]);
        Assert.Equal(30L, user["age"]);
    }

    [Fact]
    public void FromJsonHandlesArrays()
    {
        var raw = """{"items":[1,2,3]}""";
        var sr = StructuredResult.FromJson(raw);
        var items = sr["items"] as List<object?>;
        Assert.NotNull(items);
        Assert.Equal(3, items!.Count);
    }

    [Fact]
    public void FromJsonHandlesBooleans()
    {
        var raw = """{"active":true,"deleted":false}""";
        var sr = StructuredResult.FromJson(raw);
        Assert.Equal(true, sr["active"]);
        Assert.Equal(false, sr["deleted"]);
    }

    [Fact]
    public void FromJsonHandlesNull()
    {
        var raw = """{"value":null}""";
        var sr = StructuredResult.FromJson(raw);
        Assert.Null(sr["value"]);
    }

    [Fact]
    public void FromJsonNonObjectRootFallsBackToEmptyDict()
    {
        var raw = """[1,2,3]""";
        var sr = StructuredResult.FromJson(raw);
        Assert.Empty(sr);
        Assert.Equal(raw, sr.RawJson);
    }

    public record WeatherResponse(double Temperature, string Unit, string City);

    [Fact]
    public void CastToRecord()
    {
        var raw = """{"temperature":72.5,"unit":"F","city":"Seattle"}""";
        var sr = StructuredResult.FromJson(raw);
        var weather = sr.Cast<WeatherResponse>();
        Assert.Equal(72.5, weather.Temperature);
        Assert.Equal("F", weather.Unit);
        Assert.Equal("Seattle", weather.City);
    }

    [Fact]
    public void CastMethodOnResult()
    {
        var raw = """{"temperature":72.5,"unit":"F","city":"Seattle"}""";
        var sr = StructuredResult.FromJson(raw);
        var weather = sr.Cast<WeatherResponse>();
        Assert.IsType<WeatherResponse>(weather);
    }

    [Fact]
    public void StaticCastFromStructuredResult()
    {
        var raw = """{"temperature":72.5,"unit":"F","city":"Seattle"}""";
        var sr = StructuredResult.FromJson(raw);
        var weather = PromptyCast.Cast<WeatherResponse>(sr);
        Assert.Equal("Seattle", weather.City);
    }

    [Fact]
    public void StaticCastFromString()
    {
        var raw = """{"temperature":72.5,"unit":"F","city":"Portland"}""";
        var weather = PromptyCast.Cast<WeatherResponse>(raw);
        Assert.Equal("Portland", weather.City);
    }

    [Fact]
    public void StaticCastFromDict()
    {
        // Fallback path — dict gets serialized then deserialized
        var dict = new Dictionary<string, object?>
        {
            ["temperature"] = 65.0,
            ["unit"] = "F",
            ["city"] = "Denver"
        };
        var weather = PromptyCast.Cast<WeatherResponse>(dict);
        Assert.Equal("Denver", weather.City);
    }

    [Fact]
    public void EqualityWithDictionary()
    {
        var sr = new StructuredResult(
            new Dictionary<string, object?> { ["a"] = 1L },
            """{"a":1}""");
        Assert.Equal(1L, sr["a"]);
        Assert.Single(sr);
    }

    [Fact]
    public void CastHandlesCaseInsensitiveProperties()
    {
        var raw = """{"Temperature":72.5,"Unit":"F","City":"Boston"}""";
        var weather = PromptyCast.Cast<WeatherResponse>(raw);
        Assert.Equal(72.5, weather.Temperature);
        Assert.Equal("Boston", weather.City);
    }

    [Fact]
    public void ElementToNativeHandlesDoubles()
    {
        var raw = """{"value":3.14}""";
        var sr = StructuredResult.FromJson(raw);
        Assert.Equal(3.14, sr["value"]);
    }
}
