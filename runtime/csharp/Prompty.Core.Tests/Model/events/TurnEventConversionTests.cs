using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class TurnEventConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
id: evt_abc123
timestamp: "2026-06-09T20:00:00Z"
turnId: turn_001
iteration: 0
parentId: evt_parent
spanId: span_tool_001

""";

        var instance = TurnEvent.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("evt_abc123", instance.Id);
        Assert.Equal("2026-06-09T20:00:00Z", instance.Timestamp);
        Assert.Equal("turn_001", instance.TurnId);
        Assert.Equal(0, instance.Iteration);
        Assert.Equal("evt_parent", instance.ParentId);
        Assert.Equal("span_tool_001", instance.SpanId);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "id": "evt_abc123",
  "timestamp": "2026-06-09T20:00:00Z",
  "turnId": "turn_001",
  "iteration": 0,
  "parentId": "evt_parent",
  "spanId": "span_tool_001"
}
""";

        var instance = TurnEvent.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("evt_abc123", instance.Id);
        Assert.Equal("2026-06-09T20:00:00Z", instance.Timestamp);
        Assert.Equal("turn_001", instance.TurnId);
        Assert.Equal(0, instance.Iteration);
        Assert.Equal("evt_parent", instance.ParentId);
        Assert.Equal("span_tool_001", instance.SpanId);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "id": "evt_abc123",
  "timestamp": "2026-06-09T20:00:00Z",
  "turnId": "turn_001",
  "iteration": 0,
  "parentId": "evt_parent",
  "spanId": "span_tool_001"
}
""";

        var original = TurnEvent.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = TurnEvent.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("evt_abc123", reloaded.Id);
        Assert.Equal("2026-06-09T20:00:00Z", reloaded.Timestamp);
        Assert.Equal("turn_001", reloaded.TurnId);
        Assert.Equal(0, reloaded.Iteration);
        Assert.Equal("evt_parent", reloaded.ParentId);
        Assert.Equal("span_tool_001", reloaded.SpanId);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
id: evt_abc123
timestamp: "2026-06-09T20:00:00Z"
turnId: turn_001
iteration: 0
parentId: evt_parent
spanId: span_tool_001

""";

        var original = TurnEvent.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = TurnEvent.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("evt_abc123", reloaded.Id);
        Assert.Equal("2026-06-09T20:00:00Z", reloaded.Timestamp);
        Assert.Equal("turn_001", reloaded.TurnId);
        Assert.Equal(0, reloaded.Iteration);
        Assert.Equal("evt_parent", reloaded.ParentId);
        Assert.Equal("span_tool_001", reloaded.SpanId);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "id": "evt_abc123",
  "timestamp": "2026-06-09T20:00:00Z",
  "turnId": "turn_001",
  "iteration": 0,
  "parentId": "evt_parent",
  "spanId": "span_tool_001"
}
""";

        var instance = TurnEvent.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
id: evt_abc123
timestamp: "2026-06-09T20:00:00Z"
turnId: turn_001
iteration: 0
parentId: evt_parent
spanId: span_tool_001

""";

        var instance = TurnEvent.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
