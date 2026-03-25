
using Xunit;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130


public class McpToolConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
kind: mcp
connection:
  kind: reference
serverName: My MCP Server
serverDescription: This tool allows access to MCP services.
approvalMode:
  kind: always
allowedTools:
  - operation1
  - operation2

""";

        var instance = McpTool.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("mcp", instance.Kind);
        Assert.Equal("My MCP Server", instance.ServerName);
        Assert.Equal("This tool allows access to MCP services.", instance.ServerDescription);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "kind": "mcp",
  "connection": {
    "kind": "reference"
  },
  "serverName": "My MCP Server",
  "serverDescription": "This tool allows access to MCP services.",
  "approvalMode": {
    "kind": "always"
  },
  "allowedTools": [
    "operation1",
    "operation2"
  ]
}
""";

        var instance = McpTool.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("mcp", instance.Kind);
        Assert.Equal("My MCP Server", instance.ServerName);
        Assert.Equal("This tool allows access to MCP services.", instance.ServerDescription);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "kind": "mcp",
  "connection": {
    "kind": "reference"
  },
  "serverName": "My MCP Server",
  "serverDescription": "This tool allows access to MCP services.",
  "approvalMode": {
    "kind": "always"
  },
  "allowedTools": [
    "operation1",
    "operation2"
  ]
}
""";

        var original = McpTool.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = McpTool.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("mcp", reloaded.Kind);
        Assert.Equal("My MCP Server", reloaded.ServerName);
        Assert.Equal("This tool allows access to MCP services.", reloaded.ServerDescription);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
kind: mcp
connection:
  kind: reference
serverName: My MCP Server
serverDescription: This tool allows access to MCP services.
approvalMode:
  kind: always
allowedTools:
  - operation1
  - operation2

""";

        var original = McpTool.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = McpTool.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("mcp", reloaded.Kind);
        Assert.Equal("My MCP Server", reloaded.ServerName);
        Assert.Equal("This tool allows access to MCP services.", reloaded.ServerDescription);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "kind": "mcp",
  "connection": {
    "kind": "reference"
  },
  "serverName": "My MCP Server",
  "serverDescription": "This tool allows access to MCP services.",
  "approvalMode": {
    "kind": "always"
  },
  "allowedTools": [
    "operation1",
    "operation2"
  ]
}
""";

        var instance = McpTool.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
kind: mcp
connection:
  kind: reference
serverName: My MCP Server
serverDescription: This tool allows access to MCP services.
approvalMode:
  kind: always
allowedTools:
  - operation1
  - operation2

""";

        var instance = McpTool.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
