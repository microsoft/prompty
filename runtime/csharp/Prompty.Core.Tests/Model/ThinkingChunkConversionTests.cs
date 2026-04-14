
using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ThinkingChunkConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
value: Let me consider...

""";

        var instance = ThinkingChunk.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("Let me consider...", instance.Value);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "value": "Let me consider..."
}
""";

        var instance = ThinkingChunk.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("Let me consider...", instance.Value);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "value": "Let me consider..."
}
""";

        var original = ThinkingChunk.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = ThinkingChunk.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("Let me consider...", reloaded.Value);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
value: Let me consider...

""";

        var original = ThinkingChunk.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = ThinkingChunk.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("Let me consider...", reloaded.Value);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "value": "Let me consider..."
}
""";

        var instance = ThinkingChunk.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
value: Let me consider...

""";

        var instance = ThinkingChunk.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
