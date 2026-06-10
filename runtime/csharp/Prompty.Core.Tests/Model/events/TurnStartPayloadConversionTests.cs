using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class TurnStartPayloadConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
agent: weather-agent
maxIterations: 10

""";

        var instance = TurnStartPayload.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("weather-agent", instance.Agent);
        Assert.Equal(10, instance.MaxIterations);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "agent": "weather-agent",
  "maxIterations": 10
}
""";

        var instance = TurnStartPayload.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("weather-agent", instance.Agent);
        Assert.Equal(10, instance.MaxIterations);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "agent": "weather-agent",
  "maxIterations": 10
}
""";

        var original = TurnStartPayload.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = TurnStartPayload.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("weather-agent", reloaded.Agent);
        Assert.Equal(10, reloaded.MaxIterations);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
agent: weather-agent
maxIterations: 10

""";

        var original = TurnStartPayload.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = TurnStartPayload.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("weather-agent", reloaded.Agent);
        Assert.Equal(10, reloaded.MaxIterations);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "agent": "weather-agent",
  "maxIterations": 10
}
""";

        var instance = TurnStartPayload.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
agent: weather-agent
maxIterations: 10

""";

        var instance = TurnStartPayload.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
