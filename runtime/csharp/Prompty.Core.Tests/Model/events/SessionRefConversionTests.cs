using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class SessionRefConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
sessionId: sess_abc123
refType: issue
refValue: "owner/repo#123"
turnIndex: 2
createdAt: "2026-06-09T20:00:00Z"

""";

        var instance = SessionRef.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("sess_abc123", instance.SessionId);
        Assert.Equal("issue", instance.RefType);
        Assert.Equal("owner/repo#123", instance.RefValue);
        Assert.Equal(2, instance.TurnIndex);
        Assert.Equal("2026-06-09T20:00:00Z", instance.CreatedAt);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "sessionId": "sess_abc123",
  "refType": "issue",
  "refValue": "owner/repo#123",
  "turnIndex": 2,
  "createdAt": "2026-06-09T20:00:00Z"
}
""";

        var instance = SessionRef.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("sess_abc123", instance.SessionId);
        Assert.Equal("issue", instance.RefType);
        Assert.Equal("owner/repo#123", instance.RefValue);
        Assert.Equal(2, instance.TurnIndex);
        Assert.Equal("2026-06-09T20:00:00Z", instance.CreatedAt);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "sessionId": "sess_abc123",
  "refType": "issue",
  "refValue": "owner/repo#123",
  "turnIndex": 2,
  "createdAt": "2026-06-09T20:00:00Z"
}
""";

        var original = SessionRef.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = SessionRef.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("sess_abc123", reloaded.SessionId);
        Assert.Equal("issue", reloaded.RefType);
        Assert.Equal("owner/repo#123", reloaded.RefValue);
        Assert.Equal(2, reloaded.TurnIndex);
        Assert.Equal("2026-06-09T20:00:00Z", reloaded.CreatedAt);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
sessionId: sess_abc123
refType: issue
refValue: "owner/repo#123"
turnIndex: 2
createdAt: "2026-06-09T20:00:00Z"

""";

        var original = SessionRef.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = SessionRef.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("sess_abc123", reloaded.SessionId);
        Assert.Equal("issue", reloaded.RefType);
        Assert.Equal("owner/repo#123", reloaded.RefValue);
        Assert.Equal(2, reloaded.TurnIndex);
        Assert.Equal("2026-06-09T20:00:00Z", reloaded.CreatedAt);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "sessionId": "sess_abc123",
  "refType": "issue",
  "refValue": "owner/repo#123",
  "turnIndex": 2,
  "createdAt": "2026-06-09T20:00:00Z"
}
""";

        var instance = SessionRef.FromJson(jsonData);
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
refType: issue
refValue: "owner/repo#123"
turnIndex: 2
createdAt: "2026-06-09T20:00:00Z"

""";

        var instance = SessionRef.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
