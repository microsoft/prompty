
using Xunit;

#pragma warning disable IDE0130
namespace Prompty;
#pragma warning restore IDE0130


public class ParserConfigConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
kind: prompty
options:
  key: value

""";

        var instance = ParserConfig.FromYaml(yamlData);

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

        var instance = ParserConfig.FromJson(jsonData);
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

        var original = ParserConfig.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = ParserConfig.FromJson(json);
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

        var original = ParserConfig.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = ParserConfig.FromYaml(yaml);
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

        var instance = ParserConfig.FromJson(jsonData);
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

        var instance = ParserConfig.FromYaml(yamlData);
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
        var instance = ParserConfig.FromJson(data);
        Assert.NotNull(instance);
        Assert.Equal("example", instance.Kind);
    }


    [Fact]
    public void LoadYamlFromString()
    {
        // alternate representation as string
        var data = "\"example\"";
        var instance = ParserConfig.FromYaml(data);
        Assert.NotNull(instance);
        Assert.Equal("example", instance.Kind);
    }
    
}
