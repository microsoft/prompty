
using Xunit;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130


public class ReferenceConnectionConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
kind: reference
name: my-reference-connection
target: my-target-resource

""";

        var instance = ReferenceConnection.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("reference", instance.Kind);
        Assert.Equal("my-reference-connection", instance.Name);
        Assert.Equal("my-target-resource", instance.Target);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "kind": "reference",
  "name": "my-reference-connection",
  "target": "my-target-resource"
}
""";

        var instance = ReferenceConnection.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("reference", instance.Kind);
        Assert.Equal("my-reference-connection", instance.Name);
        Assert.Equal("my-target-resource", instance.Target);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "kind": "reference",
  "name": "my-reference-connection",
  "target": "my-target-resource"
}
""";

        var original = ReferenceConnection.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = ReferenceConnection.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("reference", reloaded.Kind);
        Assert.Equal("my-reference-connection", reloaded.Name);
        Assert.Equal("my-target-resource", reloaded.Target);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
kind: reference
name: my-reference-connection
target: my-target-resource

""";

        var original = ReferenceConnection.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = ReferenceConnection.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("reference", reloaded.Kind);
        Assert.Equal("my-reference-connection", reloaded.Name);
        Assert.Equal("my-target-resource", reloaded.Target);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "kind": "reference",
  "name": "my-reference-connection",
  "target": "my-target-resource"
}
""";

        var instance = ReferenceConnection.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
kind: reference
name: my-reference-connection
target: my-target-resource

""";

        var instance = ReferenceConnection.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
