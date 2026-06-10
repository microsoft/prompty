using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class RetryPayloadConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
operation: llm
attempt: 2
maxAttempts: 3
delayMs: 1250
reason: rate_limit

""";

        var instance = RetryPayload.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("llm", instance.Operation);
        Assert.Equal(2, instance.Attempt);
        Assert.Equal(3, instance.MaxAttempts);
        Assert.Equal(1250, instance.DelayMs);
        Assert.Equal("rate_limit", instance.Reason);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "operation": "llm",
  "attempt": 2,
  "maxAttempts": 3,
  "delayMs": 1250,
  "reason": "rate_limit"
}
""";

        var instance = RetryPayload.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("llm", instance.Operation);
        Assert.Equal(2, instance.Attempt);
        Assert.Equal(3, instance.MaxAttempts);
        Assert.Equal(1250, instance.DelayMs);
        Assert.Equal("rate_limit", instance.Reason);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "operation": "llm",
  "attempt": 2,
  "maxAttempts": 3,
  "delayMs": 1250,
  "reason": "rate_limit"
}
""";

        var original = RetryPayload.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = RetryPayload.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("llm", reloaded.Operation);
        Assert.Equal(2, reloaded.Attempt);
        Assert.Equal(3, reloaded.MaxAttempts);
        Assert.Equal(1250, reloaded.DelayMs);
        Assert.Equal("rate_limit", reloaded.Reason);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
operation: llm
attempt: 2
maxAttempts: 3
delayMs: 1250
reason: rate_limit

""";

        var original = RetryPayload.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = RetryPayload.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("llm", reloaded.Operation);
        Assert.Equal(2, reloaded.Attempt);
        Assert.Equal(3, reloaded.MaxAttempts);
        Assert.Equal(1250, reloaded.DelayMs);
        Assert.Equal("rate_limit", reloaded.Reason);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "operation": "llm",
  "attempt": 2,
  "maxAttempts": 3,
  "delayMs": 1250,
  "reason": "rate_limit"
}
""";

        var instance = RetryPayload.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
operation: llm
attempt: 2
maxAttempts: 3
delayMs: 1250
reason: rate_limit

""";

        var instance = RetryPayload.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
