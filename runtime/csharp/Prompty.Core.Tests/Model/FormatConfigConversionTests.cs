
using Xunit;

#pragma warning disable IDE0130
namespace Prompty;
#pragma warning restore IDE0130


public class FormatConfigConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
kind: mustache
strict: true
options:
  key: value

""";

        var instance = FormatConfig.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("mustache", instance.Kind);
        Assert.True(instance.Strict);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "kind": "mustache",
  "strict": true,
  "options": {
    "key": "value"
  }
}
""";

        var instance = FormatConfig.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("mustache", instance.Kind);
        Assert.True(instance.Strict);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "kind": "mustache",
  "strict": true,
  "options": {
    "key": "value"
  }
}
""";

        var original = FormatConfig.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = FormatConfig.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("mustache", reloaded.Kind);
        Assert.True(reloaded.Strict);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
kind: mustache
strict: true
options:
  key: value

""";

        var original = FormatConfig.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = FormatConfig.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("mustache", reloaded.Kind);
        Assert.True(reloaded.Strict);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "kind": "mustache",
  "strict": true,
  "options": {
    "key": "value"
  }
}
""";

        var instance = FormatConfig.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
kind: mustache
strict: true
options:
  key: value

""";

        var instance = FormatConfig.FromYaml(yamlData);
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
        var instance = FormatConfig.FromJson(data);
        Assert.NotNull(instance);
        Assert.Equal("example", instance.Kind);
    }


    [Fact]
    public void LoadYamlFromString()
    {
        // alternate representation as string
        var data = "\"example\"";
        var instance = FormatConfig.FromYaml(data);
        Assert.NotNull(instance);
        Assert.Equal("example", instance.Kind);
    }
    
}
