using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class StatusEventPayloadConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
message: Starting iteration 3

""";

        var instance = StatusEventPayload.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("Starting iteration 3", instance.Message);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "message": "Starting iteration 3"
}
""";

        var instance = StatusEventPayload.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("Starting iteration 3", instance.Message);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "message": "Starting iteration 3"
}
""";

        var original = StatusEventPayload.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = StatusEventPayload.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("Starting iteration 3", reloaded.Message);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
message: Starting iteration 3

""";

        var original = StatusEventPayload.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = StatusEventPayload.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("Starting iteration 3", reloaded.Message);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "message": "Starting iteration 3"
}
""";

        var instance = StatusEventPayload.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
message: Starting iteration 3

""";

        var instance = StatusEventPayload.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
