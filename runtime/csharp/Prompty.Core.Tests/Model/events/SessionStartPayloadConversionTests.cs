using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class SessionStartPayloadConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
sessionId: sess_abc123
schemaVersion: "1"
producer: prompty-agent
runtime: typescript
promptyVersion: 2.0.0
startTime: "2026-06-09T20:00:00Z"
selectedModel: gpt-4o-mini
reasoningEffort: medium

""";

        var instance = SessionStartPayload.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("sess_abc123", instance.SessionId);
        Assert.Equal("1", instance.SchemaVersion);
        Assert.Equal("prompty-agent", instance.Producer);
        Assert.Equal("typescript", instance.Runtime);
        Assert.Equal("2.0.0", instance.PromptyVersion);
        Assert.Equal("2026-06-09T20:00:00Z", instance.StartTime);
        Assert.Equal("gpt-4o-mini", instance.SelectedModel);
        Assert.Equal("medium", instance.ReasoningEffort);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "sessionId": "sess_abc123",
  "schemaVersion": "1",
  "producer": "prompty-agent",
  "runtime": "typescript",
  "promptyVersion": "2.0.0",
  "startTime": "2026-06-09T20:00:00Z",
  "selectedModel": "gpt-4o-mini",
  "reasoningEffort": "medium"
}
""";

        var instance = SessionStartPayload.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("sess_abc123", instance.SessionId);
        Assert.Equal("1", instance.SchemaVersion);
        Assert.Equal("prompty-agent", instance.Producer);
        Assert.Equal("typescript", instance.Runtime);
        Assert.Equal("2.0.0", instance.PromptyVersion);
        Assert.Equal("2026-06-09T20:00:00Z", instance.StartTime);
        Assert.Equal("gpt-4o-mini", instance.SelectedModel);
        Assert.Equal("medium", instance.ReasoningEffort);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "sessionId": "sess_abc123",
  "schemaVersion": "1",
  "producer": "prompty-agent",
  "runtime": "typescript",
  "promptyVersion": "2.0.0",
  "startTime": "2026-06-09T20:00:00Z",
  "selectedModel": "gpt-4o-mini",
  "reasoningEffort": "medium"
}
""";

        var original = SessionStartPayload.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = SessionStartPayload.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("sess_abc123", reloaded.SessionId);
        Assert.Equal("1", reloaded.SchemaVersion);
        Assert.Equal("prompty-agent", reloaded.Producer);
        Assert.Equal("typescript", reloaded.Runtime);
        Assert.Equal("2.0.0", reloaded.PromptyVersion);
        Assert.Equal("2026-06-09T20:00:00Z", reloaded.StartTime);
        Assert.Equal("gpt-4o-mini", reloaded.SelectedModel);
        Assert.Equal("medium", reloaded.ReasoningEffort);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
sessionId: sess_abc123
schemaVersion: "1"
producer: prompty-agent
runtime: typescript
promptyVersion: 2.0.0
startTime: "2026-06-09T20:00:00Z"
selectedModel: gpt-4o-mini
reasoningEffort: medium

""";

        var original = SessionStartPayload.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = SessionStartPayload.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("sess_abc123", reloaded.SessionId);
        Assert.Equal("1", reloaded.SchemaVersion);
        Assert.Equal("prompty-agent", reloaded.Producer);
        Assert.Equal("typescript", reloaded.Runtime);
        Assert.Equal("2.0.0", reloaded.PromptyVersion);
        Assert.Equal("2026-06-09T20:00:00Z", reloaded.StartTime);
        Assert.Equal("gpt-4o-mini", reloaded.SelectedModel);
        Assert.Equal("medium", reloaded.ReasoningEffort);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "sessionId": "sess_abc123",
  "schemaVersion": "1",
  "producer": "prompty-agent",
  "runtime": "typescript",
  "promptyVersion": "2.0.0",
  "startTime": "2026-06-09T20:00:00Z",
  "selectedModel": "gpt-4o-mini",
  "reasoningEffort": "medium"
}
""";

        var instance = SessionStartPayload.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
sessionId: sess_abc123
schemaVersion: "1"
producer: prompty-agent
runtime: typescript
promptyVersion: 2.0.0
startTime: "2026-06-09T20:00:00Z"
selectedModel: gpt-4o-mini
reasoningEffort: medium

""";

        var instance = SessionStartPayload.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
