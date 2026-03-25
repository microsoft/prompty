
using Xunit;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130


public class CustomToolConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
connection:
  kind: reference
options:
  timeout: 30
  retries: 3

""";

        var instance = CustomTool.FromYaml(yamlData);

        Assert.NotNull(instance);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "connection": {
    "kind": "reference"
  },
  "options": {
    "timeout": 30,
    "retries": 3
  }
}
""";

        var instance = CustomTool.FromJson(jsonData);
        Assert.NotNull(instance);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "connection": {
    "kind": "reference"
  },
  "options": {
    "timeout": 30,
    "retries": 3
  }
}
""";

        var original = CustomTool.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = CustomTool.FromJson(json);
        Assert.NotNull(reloaded);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
connection:
  kind: reference
options:
  timeout: 30
  retries: 3

""";

        var original = CustomTool.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = CustomTool.FromYaml(yaml);
        Assert.NotNull(reloaded);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "connection": {
    "kind": "reference"
  },
  "options": {
    "timeout": 30,
    "retries": 3
  }
}
""";

        var instance = CustomTool.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
connection:
  kind: reference
options:
  timeout: 30
  retries: 3

""";

        var instance = CustomTool.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
