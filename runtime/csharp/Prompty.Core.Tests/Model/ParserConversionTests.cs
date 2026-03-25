
using Xunit;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130


public class ParserConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
kind: prompty
options:
  key: value

""";

        var instance = Parser.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("prompty", instance.Kind);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "kind": "prompty",
  "options": {
    "key": "value"
  }
}
""";

        var instance = Parser.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("prompty", instance.Kind);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "kind": "prompty",
  "options": {
    "key": "value"
  }
}
""";

        var original = Parser.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = Parser.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("prompty", reloaded.Kind);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
kind: prompty
options:
  key: value

""";

        var original = Parser.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = Parser.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("prompty", reloaded.Kind);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "kind": "prompty",
  "options": {
    "key": "value"
  }
}
""";

        var instance = Parser.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
kind: prompty
options:
  key: value

""";

        var instance = Parser.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
    [Fact]
    public void LoadJsonFromString()
    {
        // alternate representation as string
        var data = "\"example\"";
        var instance = Parser.FromJson(data);
        Assert.NotNull(instance);
        Assert.Equal("example", instance.Kind);
    }


    [Fact]
    public void LoadYamlFromString()
    {
        // alternate representation as string
        var data = "\"example\"";
        var instance = Parser.FromYaml(data);
        Assert.NotNull(instance);
        Assert.Equal("example", instance.Kind);
    }
    
}
