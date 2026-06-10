using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ToolCallStartPayloadConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
id: call_abc123
name: get_weather
arguments: "{\"city\": \"Paris\"}"

""";

        var instance = ToolCallStartPayload.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("call_abc123", instance.Id);
        Assert.Equal("get_weather", instance.Name);
        Assert.Equal(@"{""city"": ""Paris""}".Replace("\r\n", "\n"), instance.Arguments);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "id": "call_abc123",
  "name": "get_weather",
  "arguments": "{\"city\": \"Paris\"}"
}
""";

        var instance = ToolCallStartPayload.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("call_abc123", instance.Id);
        Assert.Equal("get_weather", instance.Name);
        Assert.Equal(@"{""city"": ""Paris""}".Replace("\r\n", "\n"), instance.Arguments);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "id": "call_abc123",
  "name": "get_weather",
  "arguments": "{\"city\": \"Paris\"}"
}
""";

        var original = ToolCallStartPayload.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = ToolCallStartPayload.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("call_abc123", reloaded.Id);
        Assert.Equal("get_weather", reloaded.Name);
        Assert.Equal(@"{""city"": ""Paris""}".Replace("\r\n", "\n"), reloaded.Arguments);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
id: call_abc123
name: get_weather
arguments: "{\"city\": \"Paris\"}"

""";

        var original = ToolCallStartPayload.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = ToolCallStartPayload.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("call_abc123", reloaded.Id);
        Assert.Equal("get_weather", reloaded.Name);
        Assert.Equal(@"{""city"": ""Paris""}".Replace("\r\n", "\n"), reloaded.Arguments);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "id": "call_abc123",
  "name": "get_weather",
  "arguments": "{\"city\": \"Paris\"}"
}
""";

        var instance = ToolCallStartPayload.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
id: call_abc123
name: get_weather
arguments: "{\"city\": \"Paris\"}"

""";

        var instance = ToolCallStartPayload.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
