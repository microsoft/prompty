using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class TextChunkConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
value: Hello

""";

        var instance = TextChunk.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("Hello", instance.Value);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "value": "Hello"
}
""";

        var instance = TextChunk.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("Hello", instance.Value);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "value": "Hello"
}
""";

        var original = TextChunk.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = TextChunk.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("Hello", reloaded.Value);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
value: Hello

""";

        var original = TextChunk.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = TextChunk.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("Hello", reloaded.Value);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "value": "Hello"
}
""";

        var instance = TextChunk.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
value: Hello

""";

        var instance = TextChunk.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
