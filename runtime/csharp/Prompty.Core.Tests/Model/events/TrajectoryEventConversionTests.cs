using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class TrajectoryEventConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
id: traj_abc123
sessionId: sess_abc123
turnId: turn_001
toolCallId: call_abc123
turnIndex: 4
eventType: command
createdAt: "2026-06-09T20:00:00Z"

""";

        var instance = TrajectoryEvent.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("traj_abc123", instance.Id);
        Assert.Equal("sess_abc123", instance.SessionId);
        Assert.Equal("turn_001", instance.TurnId);
        Assert.Equal("call_abc123", instance.ToolCallId);
        Assert.Equal(4, instance.TurnIndex);
        Assert.Equal("command", instance.EventType);
        Assert.Equal("2026-06-09T20:00:00Z", instance.CreatedAt);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "id": "traj_abc123",
  "sessionId": "sess_abc123",
  "turnId": "turn_001",
  "toolCallId": "call_abc123",
  "turnIndex": 4,
  "eventType": "command",
  "createdAt": "2026-06-09T20:00:00Z"
}
""";

        var instance = TrajectoryEvent.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("traj_abc123", instance.Id);
        Assert.Equal("sess_abc123", instance.SessionId);
        Assert.Equal("turn_001", instance.TurnId);
        Assert.Equal("call_abc123", instance.ToolCallId);
        Assert.Equal(4, instance.TurnIndex);
        Assert.Equal("command", instance.EventType);
        Assert.Equal("2026-06-09T20:00:00Z", instance.CreatedAt);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "id": "traj_abc123",
  "sessionId": "sess_abc123",
  "turnId": "turn_001",
  "toolCallId": "call_abc123",
  "turnIndex": 4,
  "eventType": "command",
  "createdAt": "2026-06-09T20:00:00Z"
}
""";

        var original = TrajectoryEvent.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = TrajectoryEvent.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("traj_abc123", reloaded.Id);
        Assert.Equal("sess_abc123", reloaded.SessionId);
        Assert.Equal("turn_001", reloaded.TurnId);
        Assert.Equal("call_abc123", reloaded.ToolCallId);
        Assert.Equal(4, reloaded.TurnIndex);
        Assert.Equal("command", reloaded.EventType);
        Assert.Equal("2026-06-09T20:00:00Z", reloaded.CreatedAt);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
id: traj_abc123
sessionId: sess_abc123
turnId: turn_001
toolCallId: call_abc123
turnIndex: 4
eventType: command
createdAt: "2026-06-09T20:00:00Z"

""";

        var original = TrajectoryEvent.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = TrajectoryEvent.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("traj_abc123", reloaded.Id);
        Assert.Equal("sess_abc123", reloaded.SessionId);
        Assert.Equal("turn_001", reloaded.TurnId);
        Assert.Equal("call_abc123", reloaded.ToolCallId);
        Assert.Equal(4, reloaded.TurnIndex);
        Assert.Equal("command", reloaded.EventType);
        Assert.Equal("2026-06-09T20:00:00Z", reloaded.CreatedAt);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "id": "traj_abc123",
  "sessionId": "sess_abc123",
  "turnId": "turn_001",
  "toolCallId": "call_abc123",
  "turnIndex": 4,
  "eventType": "command",
  "createdAt": "2026-06-09T20:00:00Z"
}
""";

        var instance = TrajectoryEvent.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
id: traj_abc123
sessionId: sess_abc123
turnId: turn_001
toolCallId: call_abc123
turnIndex: 4
eventType: command
createdAt: "2026-06-09T20:00:00Z"

""";

        var instance = TrajectoryEvent.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
