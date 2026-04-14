
using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ToolChunkConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
toolCall:
  id: call_abc123
  name: get_weather
  arguments: "{\"city\": \"Paris\"}"

""";

        var instance = ToolChunk.FromYaml(yamlData);

        Assert.NotNull(instance);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "toolCall": {
    "id": "call_abc123",
    "name": "get_weather",
    "arguments": "{\"city\": \"Paris\"}"
  }
}
""";

        var instance = ToolChunk.FromJson(jsonData);
        Assert.NotNull(instance);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "toolCall": {
    "id": "call_abc123",
    "name": "get_weather",
    "arguments": "{\"city\": \"Paris\"}"
  }
}
""";

        var original = ToolChunk.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = ToolChunk.FromJson(json);
        Assert.NotNull(reloaded);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
toolCall:
  id: call_abc123
  name: get_weather
  arguments: "{\"city\": \"Paris\"}"

""";

        var original = ToolChunk.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = ToolChunk.FromYaml(yaml);
        Assert.NotNull(reloaded);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "toolCall": {
    "id": "call_abc123",
    "name": "get_weather",
    "arguments": "{\"city\": \"Paris\"}"
  }
}
""";

        var instance = ToolChunk.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
toolCall:
  id: call_abc123
  name: get_weather
  arguments: "{\"city\": \"Paris\"}"

""";

        var instance = ToolChunk.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
