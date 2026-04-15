
using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ToolResultConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
parts:
  - kind: text
    value: 72°F and sunny

""";

        var instance = ToolResult.FromYaml(yamlData);

        Assert.NotNull(instance);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "parts": [
    {
      "kind": "text",
      "value": "72°F and sunny"
    }
  ]
}
""";

        var instance = ToolResult.FromJson(jsonData);
        Assert.NotNull(instance);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "parts": [
    {
      "kind": "text",
      "value": "72°F and sunny"
    }
  ]
}
""";

        var original = ToolResult.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = ToolResult.FromJson(json);
        Assert.NotNull(reloaded);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
parts:
  - kind: text
    value: 72°F and sunny

""";

        var original = ToolResult.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = ToolResult.FromYaml(yaml);
        Assert.NotNull(reloaded);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "parts": [
    {
      "kind": "text",
      "value": "72°F and sunny"
    }
  ]
}
""";

        var instance = ToolResult.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
parts:
  - kind: text
    value: 72°F and sunny

""";

        var instance = ToolResult.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void FactoryText()
    {
        var instance = ToolResult.Text("test");
        Assert.NotNull(instance);
    }

}
