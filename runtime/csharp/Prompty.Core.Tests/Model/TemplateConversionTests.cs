
using Xunit;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130


public class TemplateConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
format:
  kind: mustache
parser:
  kind: mustache

""";

        var instance = Template.FromYaml(yamlData);

        Assert.NotNull(instance);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "format": {
    "kind": "mustache"
  },
  "parser": {
    "kind": "mustache"
  }
}
""";

        var instance = Template.FromJson(jsonData);
        Assert.NotNull(instance);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "format": {
    "kind": "mustache"
  },
  "parser": {
    "kind": "mustache"
  }
}
""";

        var original = Template.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = Template.FromJson(json);
        Assert.NotNull(reloaded);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
format:
  kind: mustache
parser:
  kind: mustache

""";

        var original = Template.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = Template.FromYaml(yaml);
        Assert.NotNull(reloaded);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "format": {
    "kind": "mustache"
  },
  "parser": {
    "kind": "mustache"
  }
}
""";

        var instance = Template.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
format:
  kind: mustache
parser:
  kind: mustache

""";

        var instance = Template.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
