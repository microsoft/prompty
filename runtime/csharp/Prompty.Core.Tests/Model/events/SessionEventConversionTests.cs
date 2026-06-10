using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class SessionEventConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
id: evt_abc123
timestamp: "2026-06-09T20:00:00Z"
sessionId: sess_abc123
turnId: turn_001
parentId: evt_parent
spanId: span_hook_001

""";

        var instance = SessionEvent.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("evt_abc123", instance.Id);
        Assert.Equal("2026-06-09T20:00:00Z", instance.Timestamp);
        Assert.Equal("sess_abc123", instance.SessionId);
        Assert.Equal("turn_001", instance.TurnId);
        Assert.Equal("evt_parent", instance.ParentId);
        Assert.Equal("span_hook_001", instance.SpanId);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "id": "evt_abc123",
  "timestamp": "2026-06-09T20:00:00Z",
  "sessionId": "sess_abc123",
  "turnId": "turn_001",
  "parentId": "evt_parent",
  "spanId": "span_hook_001"
}
""";

        var instance = SessionEvent.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("evt_abc123", instance.Id);
        Assert.Equal("2026-06-09T20:00:00Z", instance.Timestamp);
        Assert.Equal("sess_abc123", instance.SessionId);
        Assert.Equal("turn_001", instance.TurnId);
        Assert.Equal("evt_parent", instance.ParentId);
        Assert.Equal("span_hook_001", instance.SpanId);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "id": "evt_abc123",
  "timestamp": "2026-06-09T20:00:00Z",
  "sessionId": "sess_abc123",
  "turnId": "turn_001",
  "parentId": "evt_parent",
  "spanId": "span_hook_001"
}
""";

        var original = SessionEvent.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = SessionEvent.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("evt_abc123", reloaded.Id);
        Assert.Equal("2026-06-09T20:00:00Z", reloaded.Timestamp);
        Assert.Equal("sess_abc123", reloaded.SessionId);
        Assert.Equal("turn_001", reloaded.TurnId);
        Assert.Equal("evt_parent", reloaded.ParentId);
        Assert.Equal("span_hook_001", reloaded.SpanId);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
id: evt_abc123
timestamp: "2026-06-09T20:00:00Z"
sessionId: sess_abc123
turnId: turn_001
parentId: evt_parent
spanId: span_hook_001

""";

        var original = SessionEvent.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = SessionEvent.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("evt_abc123", reloaded.Id);
        Assert.Equal("2026-06-09T20:00:00Z", reloaded.Timestamp);
        Assert.Equal("sess_abc123", reloaded.SessionId);
        Assert.Equal("turn_001", reloaded.TurnId);
        Assert.Equal("evt_parent", reloaded.ParentId);
        Assert.Equal("span_hook_001", reloaded.SpanId);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "id": "evt_abc123",
  "timestamp": "2026-06-09T20:00:00Z",
  "sessionId": "sess_abc123",
  "turnId": "turn_001",
  "parentId": "evt_parent",
  "spanId": "span_hook_001"
}
""";

        var instance = SessionEvent.FromJson(jsonData);
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
sessionId: sess_abc123
turnId: turn_001
parentId: evt_parent
spanId: span_hook_001

""";

        var instance = SessionEvent.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
