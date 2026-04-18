using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class StreamOptionsConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
includeUsage: true

""";

        var instance = StreamOptions.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.True(instance.IncludeUsage);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "includeUsage": true
}
""";

        var instance = StreamOptions.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.True(instance.IncludeUsage);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "includeUsage": true
}
""";

        var original = StreamOptions.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = StreamOptions.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.True(reloaded.IncludeUsage);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
includeUsage: true

""";

        var original = StreamOptions.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = StreamOptions.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.True(reloaded.IncludeUsage);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "includeUsage": true
}
""";

        var instance = StreamOptions.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
includeUsage: true

""";

        var instance = StreamOptions.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
