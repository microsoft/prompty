using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class TurnOptionsConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
maxIterations: 10
maxLlmRetries: 3
contextBudget: 100000
parallelToolCalls: true
raw: false
turn: 1
compaction:
  strategy: summarize

""";

        var instance = TurnOptions.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal(10, instance.MaxIterations);
        Assert.Equal(3, instance.MaxLlmRetries);
        Assert.Equal(100000, instance.ContextBudget);
        Assert.True(instance.ParallelToolCalls);
        Assert.False(instance.Raw);
        Assert.Equal(1, instance.Turn);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "maxIterations": 10,
  "maxLlmRetries": 3,
  "contextBudget": 100000,
  "parallelToolCalls": true,
  "raw": false,
  "turn": 1,
  "compaction": {
    "strategy": "summarize"
  }
}
""";

        var instance = TurnOptions.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(10, instance.MaxIterations);
        Assert.Equal(3, instance.MaxLlmRetries);
        Assert.Equal(100000, instance.ContextBudget);
        Assert.True(instance.ParallelToolCalls);
        Assert.False(instance.Raw);
        Assert.Equal(1, instance.Turn);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "maxIterations": 10,
  "maxLlmRetries": 3,
  "contextBudget": 100000,
  "parallelToolCalls": true,
  "raw": false,
  "turn": 1,
  "compaction": {
    "strategy": "summarize"
  }
}
""";

        var original = TurnOptions.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = TurnOptions.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal(10, reloaded.MaxIterations);
        Assert.Equal(3, reloaded.MaxLlmRetries);
        Assert.Equal(100000, reloaded.ContextBudget);
        Assert.True(reloaded.ParallelToolCalls);
        Assert.False(reloaded.Raw);
        Assert.Equal(1, reloaded.Turn);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
maxIterations: 10
maxLlmRetries: 3
contextBudget: 100000
parallelToolCalls: true
raw: false
turn: 1
compaction:
  strategy: summarize

""";

        var original = TurnOptions.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = TurnOptions.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal(10, reloaded.MaxIterations);
        Assert.Equal(3, reloaded.MaxLlmRetries);
        Assert.Equal(100000, reloaded.ContextBudget);
        Assert.True(reloaded.ParallelToolCalls);
        Assert.False(reloaded.Raw);
        Assert.Equal(1, reloaded.Turn);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "maxIterations": 10,
  "maxLlmRetries": 3,
  "contextBudget": 100000,
  "parallelToolCalls": true,
  "raw": false,
  "turn": 1,
  "compaction": {
    "strategy": "summarize"
  }
}
""";

        var instance = TurnOptions.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
maxIterations: 10
maxLlmRetries: 3
contextBudget: 100000
parallelToolCalls: true
raw: false
turn: 1
compaction:
  strategy: summarize

""";

        var instance = TurnOptions.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
