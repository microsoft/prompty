using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ArrayParameterConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        items:
          kind: string
        
        """;

        var instance = YamlSerializer.Deserialize<ArrayParameter>(yamlData);

        Assert.NotNull(instance);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "items": {
            "kind": "string"
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<ArrayParameter>(jsonData);
        Assert.NotNull(instance);
    }
}