using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class CompactionStartPayloadConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
droppedCount: 5

""";

        var instance = CompactionStartPayload.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal(5, instance.DroppedCount);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "droppedCount": 5
}
""";

        var instance = CompactionStartPayload.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(5, instance.DroppedCount);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "droppedCount": 5
}
""";

        var original = CompactionStartPayload.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = CompactionStartPayload.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal(5, reloaded.DroppedCount);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
droppedCount: 5

""";

        var original = CompactionStartPayload.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = CompactionStartPayload.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal(5, reloaded.DroppedCount);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "droppedCount": 5
}
""";

        var instance = CompactionStartPayload.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
droppedCount: 5

""";

        var instance = CompactionStartPayload.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
