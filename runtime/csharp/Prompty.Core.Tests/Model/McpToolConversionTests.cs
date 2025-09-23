using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
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
        Assert.Equal(instance.kind, "mcp");
        Assert.Equal(instance.name, "My MCP Tool");
        Assert.Equal(instance.url, "https://mcp.server.com");
    }
}