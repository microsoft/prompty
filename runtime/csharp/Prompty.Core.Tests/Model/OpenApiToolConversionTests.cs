
using Xunit;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130


public class OpenApiToolConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
kind: openapi
connection:
  kind: reference
specification: full_sepcification_here

""";

        var instance = OpenApiTool.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("openapi", instance.Kind);
        Assert.Equal("full_sepcification_here", instance.Specification);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "kind": "openapi",
  "connection": {
    "kind": "reference"
  },
  "specification": "full_sepcification_here"
}
""";

        var instance = OpenApiTool.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("openapi", instance.Kind);
        Assert.Equal("full_sepcification_here", instance.Specification);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "kind": "openapi",
  "connection": {
    "kind": "reference"
  },
  "specification": "full_sepcification_here"
}
""";

        var original = OpenApiTool.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = OpenApiTool.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("openapi", reloaded.Kind);
        Assert.Equal("full_sepcification_here", reloaded.Specification);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
kind: openapi
connection:
  kind: reference
specification: full_sepcification_here

""";

        var original = OpenApiTool.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = OpenApiTool.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("openapi", reloaded.Kind);
        Assert.Equal("full_sepcification_here", reloaded.Specification);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "kind": "openapi",
  "connection": {
    "kind": "reference"
  },
  "specification": "full_sepcification_here"
}
""";

        var instance = OpenApiTool.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
kind: openapi
connection:
  kind: reference
specification: full_sepcification_here

""";

        var instance = OpenApiTool.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
