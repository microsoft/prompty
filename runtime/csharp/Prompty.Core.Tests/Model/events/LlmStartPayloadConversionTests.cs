using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class LlmStartPayloadConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
provider: openai
modelId: gpt-4o-mini
messageCount: 4
attempt: 0

""";

        var instance = LlmStartPayload.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("openai", instance.Provider);
        Assert.Equal("gpt-4o-mini", instance.ModelId);
        Assert.Equal(4, instance.MessageCount);
        Assert.Equal(0, instance.Attempt);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "provider": "openai",
  "modelId": "gpt-4o-mini",
  "messageCount": 4,
  "attempt": 0
}
""";

        var instance = LlmStartPayload.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("openai", instance.Provider);
        Assert.Equal("gpt-4o-mini", instance.ModelId);
        Assert.Equal(4, instance.MessageCount);
        Assert.Equal(0, instance.Attempt);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "provider": "openai",
  "modelId": "gpt-4o-mini",
  "messageCount": 4,
  "attempt": 0
}
""";

        var original = LlmStartPayload.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = LlmStartPayload.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("openai", reloaded.Provider);
        Assert.Equal("gpt-4o-mini", reloaded.ModelId);
        Assert.Equal(4, reloaded.MessageCount);
        Assert.Equal(0, reloaded.Attempt);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
provider: openai
modelId: gpt-4o-mini
messageCount: 4
attempt: 0

""";

        var original = LlmStartPayload.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = LlmStartPayload.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("openai", reloaded.Provider);
        Assert.Equal("gpt-4o-mini", reloaded.ModelId);
        Assert.Equal(4, reloaded.MessageCount);
        Assert.Equal(0, reloaded.Attempt);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "provider": "openai",
  "modelId": "gpt-4o-mini",
  "messageCount": 4,
  "attempt": 0
}
""";

        var instance = LlmStartPayload.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
provider: openai
modelId: gpt-4o-mini
messageCount: 4
attempt: 0

""";

        var instance = LlmStartPayload.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
