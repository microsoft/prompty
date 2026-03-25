
using Xunit;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130


public class FormatConversionTests
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

        var instance = Format.FromYaml(yamlData);

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

        var instance = Format.FromJson(jsonData);
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

        var original = Format.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = Format.FromJson(json);
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

        var original = Format.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = Format.FromYaml(yaml);
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

        var instance = Format.FromJson(jsonData);
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

        var instance = Format.FromYaml(yamlData);
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
        var instance = Format.FromJson(data);
        Assert.NotNull(instance);
        Assert.Equal("example", instance.Kind);
    }


    [Fact]
    public void LoadYamlFromString()
    {
        // alternate representation as string
        var data = "\"example\"";
        var instance = Format.FromYaml(data);
        Assert.NotNull(instance);
        Assert.Equal("example", instance.Kind);
    }
    
}
