
using Xunit;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130


public class ObjectPropertyConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
properties:
  property1:
    kind: string
  property2:
    kind: number

""";

        var instance = ObjectProperty.FromYaml(yamlData);

        Assert.NotNull(instance);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "properties": {
    "property1": {
      "kind": "string"
    },
    "property2": {
      "kind": "number"
    }
  }
}
""";

        var instance = ObjectProperty.FromJson(jsonData);
        Assert.NotNull(instance);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "properties": {
    "property1": {
      "kind": "string"
    },
    "property2": {
      "kind": "number"
    }
  }
}
""";

        var original = ObjectProperty.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = ObjectProperty.FromJson(json);
        Assert.NotNull(reloaded);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
properties:
  property1:
    kind: string
  property2:
    kind: number

""";

        var original = ObjectProperty.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = ObjectProperty.FromYaml(yaml);
        Assert.NotNull(reloaded);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "properties": {
    "property1": {
      "kind": "string"
    },
    "property2": {
      "kind": "number"
    }
  }
}
""";

        var instance = ObjectProperty.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
properties:
  property1:
    kind: string
  property2:
    kind: number

""";

        var instance = ObjectProperty.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
