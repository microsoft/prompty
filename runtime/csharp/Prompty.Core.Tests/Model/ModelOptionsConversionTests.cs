
using Xunit;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130


public class ModelOptionsConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
frequencyPenalty: 0.5
maxOutputTokens: 2048
presencePenalty: 0.3
seed: 42
temperature: 0.7
topK: 40
topP: 0.9
stopSequences:
  - "\n"
  - "###"
allowMultipleToolCalls: true
additionalProperties:
  customProperty: value
  anotherProperty: anotherValue

""";

        var instance = ModelOptions.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal(0.5f, instance.FrequencyPenalty);
        Assert.Equal(2048, instance.MaxOutputTokens);
        Assert.Equal(0.3f, instance.PresencePenalty);
        Assert.Equal(42, instance.Seed);
        Assert.Equal(0.7f, instance.Temperature);
        Assert.Equal(40, instance.TopK);
        Assert.Equal(0.9f, instance.TopP);
        Assert.True(instance.AllowMultipleToolCalls);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "frequencyPenalty": 0.5,
  "maxOutputTokens": 2048,
  "presencePenalty": 0.3,
  "seed": 42,
  "temperature": 0.7,
  "topK": 40,
  "topP": 0.9,
  "stopSequences": [
    "\n",
    "###"
  ],
  "allowMultipleToolCalls": true,
  "additionalProperties": {
    "customProperty": "value",
    "anotherProperty": "anotherValue"
  }
}
""";

        var instance = ModelOptions.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(0.5f, instance.FrequencyPenalty);
        Assert.Equal(2048, instance.MaxOutputTokens);
        Assert.Equal(0.3f, instance.PresencePenalty);
        Assert.Equal(42, instance.Seed);
        Assert.Equal(0.7f, instance.Temperature);
        Assert.Equal(40, instance.TopK);
        Assert.Equal(0.9f, instance.TopP);
        Assert.True(instance.AllowMultipleToolCalls);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "frequencyPenalty": 0.5,
  "maxOutputTokens": 2048,
  "presencePenalty": 0.3,
  "seed": 42,
  "temperature": 0.7,
  "topK": 40,
  "topP": 0.9,
  "stopSequences": [
    "\n",
    "###"
  ],
  "allowMultipleToolCalls": true,
  "additionalProperties": {
    "customProperty": "value",
    "anotherProperty": "anotherValue"
  }
}
""";

        var original = ModelOptions.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = ModelOptions.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal(0.5f, reloaded.FrequencyPenalty);
        Assert.Equal(2048, reloaded.MaxOutputTokens);
        Assert.Equal(0.3f, reloaded.PresencePenalty);
        Assert.Equal(42, reloaded.Seed);
        Assert.Equal(0.7f, reloaded.Temperature);
        Assert.Equal(40, reloaded.TopK);
        Assert.Equal(0.9f, reloaded.TopP);
        Assert.True(reloaded.AllowMultipleToolCalls);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
frequencyPenalty: 0.5
maxOutputTokens: 2048
presencePenalty: 0.3
seed: 42
temperature: 0.7
topK: 40
topP: 0.9
stopSequences:
  - "\n"
  - "###"
allowMultipleToolCalls: true
additionalProperties:
  customProperty: value
  anotherProperty: anotherValue

""";

        var original = ModelOptions.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = ModelOptions.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal(0.5f, reloaded.FrequencyPenalty);
        Assert.Equal(2048, reloaded.MaxOutputTokens);
        Assert.Equal(0.3f, reloaded.PresencePenalty);
        Assert.Equal(42, reloaded.Seed);
        Assert.Equal(0.7f, reloaded.Temperature);
        Assert.Equal(40, reloaded.TopK);
        Assert.Equal(0.9f, reloaded.TopP);
        Assert.True(reloaded.AllowMultipleToolCalls);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "frequencyPenalty": 0.5,
  "maxOutputTokens": 2048,
  "presencePenalty": 0.3,
  "seed": 42,
  "temperature": 0.7,
  "topK": 40,
  "topP": 0.9,
  "stopSequences": [
    "\n",
    "###"
  ],
  "allowMultipleToolCalls": true,
  "additionalProperties": {
    "customProperty": "value",
    "anotherProperty": "anotherValue"
  }
}
""";

        var instance = ModelOptions.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
frequencyPenalty: 0.5
maxOutputTokens: 2048
presencePenalty: 0.3
seed: 42
temperature: 0.7
topK: 40
topP: 0.9
stopSequences:
  - "\n"
  - "###"
allowMultipleToolCalls: true
additionalProperties:
  customProperty: value
  anotherProperty: anotherValue

""";

        var instance = ModelOptions.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
