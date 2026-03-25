
using Xunit;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130


public class ToolConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
name: my-tool
kind: function
description: A description of the tool
bindings:
  input: value

""";

        var instance = Tool.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("my-tool", instance.Name);
        Assert.Equal("function", instance.Kind);
        Assert.Equal("A description of the tool", instance.Description);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "name": "my-tool",
  "kind": "function",
  "description": "A description of the tool",
  "bindings": {
    "input": "value"
  }
}
""";

        var instance = Tool.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("my-tool", instance.Name);
        Assert.Equal("function", instance.Kind);
        Assert.Equal("A description of the tool", instance.Description);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "name": "my-tool",
  "kind": "function",
  "description": "A description of the tool",
  "bindings": {
    "input": "value"
  }
}
""";

        var original = Tool.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = Tool.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("my-tool", reloaded.Name);
        Assert.Equal("function", reloaded.Kind);
        Assert.Equal("A description of the tool", reloaded.Description);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
name: my-tool
kind: function
description: A description of the tool
bindings:
  input: value

""";

        var original = Tool.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = Tool.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("my-tool", reloaded.Name);
        Assert.Equal("function", reloaded.Kind);
        Assert.Equal("A description of the tool", reloaded.Description);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "name": "my-tool",
  "kind": "function",
  "description": "A description of the tool",
  "bindings": {
    "input": "value"
  }
}
""";

        var instance = Tool.FromJson(jsonData);
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
kind: function
description: A description of the tool
bindings:
  input: value

""";

        var instance = Tool.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
