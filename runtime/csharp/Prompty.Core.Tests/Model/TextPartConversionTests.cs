
using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class TextPartConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
value: Hello, world!

""";

        var instance = TextPart.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("Hello, world!", instance.Value);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "value": "Hello, world!"
}
""";

        var instance = TextPart.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("Hello, world!", instance.Value);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "value": "Hello, world!"
}
""";

        var original = TextPart.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = TextPart.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("Hello, world!", reloaded.Value);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
value: Hello, world!

""";

        var original = TextPart.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = TextPart.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("Hello, world!", reloaded.Value);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "value": "Hello, world!"
}
""";

        var instance = TextPart.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
value: Hello, world!

""";

        var instance = TextPart.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
