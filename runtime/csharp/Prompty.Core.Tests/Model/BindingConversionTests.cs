
using Xunit;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130


public class BindingConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
name: my-tool
input: input-variable

""";

        var instance = Binding.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("my-tool", instance.Name);
        Assert.Equal("input-variable", instance.Input);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "name": "my-tool",
  "input": "input-variable"
}
""";

        var instance = Binding.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("my-tool", instance.Name);
        Assert.Equal("input-variable", instance.Input);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "name": "my-tool",
  "input": "input-variable"
}
""";

        var original = Binding.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = Binding.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("my-tool", reloaded.Name);
        Assert.Equal("input-variable", reloaded.Input);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
name: my-tool
input: input-variable

""";

        var original = Binding.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = Binding.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("my-tool", reloaded.Name);
        Assert.Equal("input-variable", reloaded.Input);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "name": "my-tool",
  "input": "input-variable"
}
""";

        var instance = Binding.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
name: my-tool
input: input-variable

""";

        var instance = Binding.FromYaml(yamlData);
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
        var instance = Binding.FromJson(data);
        Assert.NotNull(instance);
        Assert.Equal("example", instance.Input);
    }


    [Fact]
    public void LoadYamlFromString()
    {
        // alternate representation as string
        var data = "\"example\"";
        var instance = Binding.FromYaml(data);
        Assert.NotNull(instance);
        Assert.Equal("example", instance.Input);
    }
    
}
