using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ServerToolConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        connection:
          kind: provider-connection
        options:
          timeout: 30
          retries: 3
        
        """;

        var instance = YamlSerializer.Deserialize<ServerTool>(yamlData);

        Assert.NotNull(instance);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "connection": {
            "kind": "provider-connection"
          },
          "options": {
            "timeout": 30,
            "retries": 3
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<ServerTool>(jsonData);
        Assert.NotNull(instance);
    }
}