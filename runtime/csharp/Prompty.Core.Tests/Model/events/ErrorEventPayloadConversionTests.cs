using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ErrorEventPayloadConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
message: Rate limit exceeded
errorKind: rate_limit
phase: llm

""";

        var instance = ErrorEventPayload.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("Rate limit exceeded", instance.Message);
        Assert.Equal("rate_limit", instance.ErrorKind);
        Assert.Equal("llm", instance.Phase);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "message": "Rate limit exceeded",
  "errorKind": "rate_limit",
  "phase": "llm"
}
""";

        var instance = ErrorEventPayload.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("Rate limit exceeded", instance.Message);
        Assert.Equal("rate_limit", instance.ErrorKind);
        Assert.Equal("llm", instance.Phase);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "message": "Rate limit exceeded",
  "errorKind": "rate_limit",
  "phase": "llm"
}
""";

        var original = ErrorEventPayload.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = ErrorEventPayload.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("Rate limit exceeded", reloaded.Message);
        Assert.Equal("rate_limit", reloaded.ErrorKind);
        Assert.Equal("llm", reloaded.Phase);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
message: Rate limit exceeded
errorKind: rate_limit
phase: llm

""";

        var original = ErrorEventPayload.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = ErrorEventPayload.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("Rate limit exceeded", reloaded.Message);
        Assert.Equal("rate_limit", reloaded.ErrorKind);
        Assert.Equal("llm", reloaded.Phase);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "message": "Rate limit exceeded",
  "errorKind": "rate_limit",
  "phase": "llm"
}
""";

        var instance = ErrorEventPayload.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
message: Rate limit exceeded
errorKind: rate_limit
phase: llm

""";

        var instance = ErrorEventPayload.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
