
using Xunit;

#pragma warning disable IDE0130
namespace Prompty;
#pragma warning restore IDE0130


public class McpApprovalModeConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
kind: never
alwaysRequireApprovalTools:
  - operation1
neverRequireApprovalTools:
  - operation2

""";

        var instance = McpApprovalMode.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("never", instance.Kind);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "kind": "never",
  "alwaysRequireApprovalTools": [
    "operation1"
  ],
  "neverRequireApprovalTools": [
    "operation2"
  ]
}
""";

        var instance = McpApprovalMode.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("never", instance.Kind);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "kind": "never",
  "alwaysRequireApprovalTools": [
    "operation1"
  ],
  "neverRequireApprovalTools": [
    "operation2"
  ]
}
""";

        var original = McpApprovalMode.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = McpApprovalMode.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("never", reloaded.Kind);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
kind: never
alwaysRequireApprovalTools:
  - operation1
neverRequireApprovalTools:
  - operation2

""";

        var original = McpApprovalMode.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = McpApprovalMode.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("never", reloaded.Kind);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "kind": "never",
  "alwaysRequireApprovalTools": [
    "operation1"
  ],
  "neverRequireApprovalTools": [
    "operation2"
  ]
}
""";

        var instance = McpApprovalMode.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
kind: never
alwaysRequireApprovalTools:
  - operation1
neverRequireApprovalTools:
  - operation2

""";

        var instance = McpApprovalMode.FromYaml(yamlData);
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
        var data = "\"never\"";
        var instance = McpApprovalMode.FromJson(data);
        Assert.NotNull(instance);
        Assert.Equal("never", instance.Kind);
    }


    [Fact]
    public void LoadYamlFromString()
    {
        // alternate representation as string
        var data = "\"never\"";
        var instance = McpApprovalMode.FromYaml(data);
        Assert.NotNull(instance);
        Assert.Equal("never", instance.Kind);
    }
    
}
