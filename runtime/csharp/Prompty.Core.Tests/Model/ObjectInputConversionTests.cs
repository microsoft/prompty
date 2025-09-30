using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ObjectInputConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        properties:
          property1:
            kind: string
          property2:
            kind: number
        
        """;

        var instance = YamlSerializer.Deserialize<ObjectInput>(yamlData);

        Assert.NotNull(instance);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "properties": {
            "property1": {
              "kind": "string"
            },
            "property2": {
              "kind": "number"
            }
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<ObjectInput>(jsonData);
        Assert.NotNull(instance);
    }
}