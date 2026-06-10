using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class LlmCompletePayloadConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
requestId: req_abc123
serviceRequestId: srv_abc123
durationMs: 820

""";

        var instance = LlmCompletePayload.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("req_abc123", instance.RequestId);
        Assert.Equal("srv_abc123", instance.ServiceRequestId);
        Assert.Equal(820, instance.DurationMs);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "requestId": "req_abc123",
  "serviceRequestId": "srv_abc123",
  "durationMs": 820
}
""";

        var instance = LlmCompletePayload.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("req_abc123", instance.RequestId);
        Assert.Equal("srv_abc123", instance.ServiceRequestId);
        Assert.Equal(820, instance.DurationMs);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "requestId": "req_abc123",
  "serviceRequestId": "srv_abc123",
  "durationMs": 820
}
""";

        var original = LlmCompletePayload.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = LlmCompletePayload.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("req_abc123", reloaded.RequestId);
        Assert.Equal("srv_abc123", reloaded.ServiceRequestId);
        Assert.Equal(820, reloaded.DurationMs);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
requestId: req_abc123
serviceRequestId: srv_abc123
durationMs: 820

""";

        var original = LlmCompletePayload.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = LlmCompletePayload.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("req_abc123", reloaded.RequestId);
        Assert.Equal("srv_abc123", reloaded.ServiceRequestId);
        Assert.Equal(820, reloaded.DurationMs);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "requestId": "req_abc123",
  "serviceRequestId": "srv_abc123",
  "durationMs": 820
}
""";

        var instance = LlmCompletePayload.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
requestId: req_abc123
serviceRequestId: srv_abc123
durationMs: 820

""";

        var instance = LlmCompletePayload.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
