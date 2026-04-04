
using Xunit;

#pragma warning disable IDE0130
namespace Prompty;
#pragma warning restore IDE0130


public class PromptyToolConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
kind: prompty
path: ./summarize.prompty
mode: single

""";

        var instance = PromptyTool.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("prompty", instance.Kind);
        Assert.Equal("./summarize.prompty", instance.Path);
        Assert.Equal("single", instance.Mode);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "kind": "prompty",
  "path": "./summarize.prompty",
  "mode": "single"
}
""";

        var instance = PromptyTool.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("prompty", instance.Kind);
        Assert.Equal("./summarize.prompty", instance.Path);
        Assert.Equal("single", instance.Mode);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "kind": "prompty",
  "path": "./summarize.prompty",
  "mode": "single"
}
""";

        var original = PromptyTool.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = PromptyTool.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("prompty", reloaded.Kind);
        Assert.Equal("./summarize.prompty", reloaded.Path);
        Assert.Equal("single", reloaded.Mode);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
kind: prompty
path: ./summarize.prompty
mode: single

""";

        var original = PromptyTool.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = PromptyTool.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("prompty", reloaded.Kind);
        Assert.Equal("./summarize.prompty", reloaded.Path);
        Assert.Equal("single", reloaded.Mode);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "kind": "prompty",
  "path": "./summarize.prompty",
  "mode": "single"
}
""";

        var instance = PromptyTool.FromJson(jsonData);
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
path: ./summarize.prompty
mode: single

""";

        var instance = PromptyTool.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
