using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
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
        Assert.Equal(typeof(string), yamlData.GetType());
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