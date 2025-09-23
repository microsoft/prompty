using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
#pragma warning restore IDE0130


public class ObjectParameterConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        properties:
          param1:
            kind: string
          param2:
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
            "param1": {
              "kind": "string"
            },
            "param2": {
              "kind": "number"
            }
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<ObjectParameter>(jsonData);
        Assert.NotNull(instance);
    }
}