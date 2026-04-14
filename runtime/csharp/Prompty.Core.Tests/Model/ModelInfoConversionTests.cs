
using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ModelInfoConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
id: gpt-4o
displayName: GPT-4o
ownedBy: openai
contextWindow: 128000
inputModalities:
  - text
  - image
outputModalities:
  - text
additionalProperties:
  supportsStreaming: true

""";

        var instance = ModelInfo.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("gpt-4o", instance.Id);
        Assert.Equal("GPT-4o", instance.DisplayName);
        Assert.Equal("openai", instance.OwnedBy);
        Assert.Equal(128000, instance.ContextWindow);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "id": "gpt-4o",
  "displayName": "GPT-4o",
  "ownedBy": "openai",
  "contextWindow": 128000,
  "inputModalities": [
    "text",
    "image"
  ],
  "outputModalities": [
    "text"
  ],
  "additionalProperties": {
    "supportsStreaming": true
  }
}
""";

        var instance = ModelInfo.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("gpt-4o", instance.Id);
        Assert.Equal("GPT-4o", instance.DisplayName);
        Assert.Equal("openai", instance.OwnedBy);
        Assert.Equal(128000, instance.ContextWindow);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "id": "gpt-4o",
  "displayName": "GPT-4o",
  "ownedBy": "openai",
  "contextWindow": 128000,
  "inputModalities": [
    "text",
    "image"
  ],
  "outputModalities": [
    "text"
  ],
  "additionalProperties": {
    "supportsStreaming": true
  }
}
""";

        var original = ModelInfo.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = ModelInfo.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("gpt-4o", reloaded.Id);
        Assert.Equal("GPT-4o", reloaded.DisplayName);
        Assert.Equal("openai", reloaded.OwnedBy);
        Assert.Equal(128000, reloaded.ContextWindow);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
id: gpt-4o
displayName: GPT-4o
ownedBy: openai
contextWindow: 128000
inputModalities:
  - text
  - image
outputModalities:
  - text
additionalProperties:
  supportsStreaming: true

""";

        var original = ModelInfo.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = ModelInfo.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("gpt-4o", reloaded.Id);
        Assert.Equal("GPT-4o", reloaded.DisplayName);
        Assert.Equal("openai", reloaded.OwnedBy);
        Assert.Equal(128000, reloaded.ContextWindow);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "id": "gpt-4o",
  "displayName": "GPT-4o",
  "ownedBy": "openai",
  "contextWindow": 128000,
  "inputModalities": [
    "text",
    "image"
  ],
  "outputModalities": [
    "text"
  ],
  "additionalProperties": {
    "supportsStreaming": true
  }
}
""";

        var instance = ModelInfo.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
id: gpt-4o
displayName: GPT-4o
ownedBy: openai
contextWindow: 128000
inputModalities:
  - text
  - image
outputModalities:
  - text
additionalProperties:
  supportsStreaming: true

""";

        var instance = ModelInfo.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
