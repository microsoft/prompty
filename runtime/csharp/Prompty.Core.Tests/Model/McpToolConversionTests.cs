using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class McpToolConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: mcp
        connection:
          kind: provider-connection
        name: My MCP Tool
        url: https://mcp.server.com
        allowed:
          - operation1
          - operation2
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "mcp",
          "connection": {
            "kind": "provider-connection"
          },
          "name": "My MCP Tool",
          "url": "https://mcp.server.com",
          "allowed": [
            "operation1",
            "operation2"
          ]
        }
        """;

        var instance = JsonSerializer.Deserialize<McpTool>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("mcp", instance.Kind);
        Assert.Equal("My MCP Tool", instance.Name);
        Assert.Equal("https://mcp.server.com", instance.Url);
    }
}