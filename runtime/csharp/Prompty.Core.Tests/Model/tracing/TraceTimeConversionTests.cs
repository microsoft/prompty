using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class TraceTimeConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
start: "2026-04-04T12:00:00Z"
end: "2026-04-04T12:00:01Z"
duration: 1000

""";

        var instance = TraceTime.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("2026-04-04T12:00:00Z", instance.Start);
        Assert.Equal("2026-04-04T12:00:01Z", instance.End);
        Assert.Equal(1000, instance.Duration);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "start": "2026-04-04T12:00:00Z",
  "end": "2026-04-04T12:00:01Z",
  "duration": 1000
}
""";

        var instance = TraceTime.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("2026-04-04T12:00:00Z", instance.Start);
        Assert.Equal("2026-04-04T12:00:01Z", instance.End);
        Assert.Equal(1000, instance.Duration);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "start": "2026-04-04T12:00:00Z",
  "end": "2026-04-04T12:00:01Z",
  "duration": 1000
}
""";

        var original = TraceTime.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = TraceTime.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("2026-04-04T12:00:00Z", reloaded.Start);
        Assert.Equal("2026-04-04T12:00:01Z", reloaded.End);
        Assert.Equal(1000, reloaded.Duration);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
start: "2026-04-04T12:00:00Z"
end: "2026-04-04T12:00:01Z"
duration: 1000

""";

        var original = TraceTime.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = TraceTime.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("2026-04-04T12:00:00Z", reloaded.Start);
        Assert.Equal("2026-04-04T12:00:01Z", reloaded.End);
        Assert.Equal(1000, reloaded.Duration);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "start": "2026-04-04T12:00:00Z",
  "end": "2026-04-04T12:00:01Z",
  "duration": 1000
}
""";

        var instance = TraceTime.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
start: "2026-04-04T12:00:00Z"
end: "2026-04-04T12:00:01Z"
duration: 1000

""";

        var instance = TraceTime.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
