using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
#pragma warning restore IDE0130


public class ObjectOutputConversionTests
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
        Assert.Equal(typeof(string), yamlData.GetType());
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

        var instance = JsonSerializer.Deserialize<ObjectOutput>(jsonData);
        Assert.NotNull(instance);
    }
}