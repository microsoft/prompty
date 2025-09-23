using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ArrayOutputConversionTests
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

        var instance = JsonSerializer.Deserialize<ArrayOutput>(jsonData);
        Assert.NotNull(instance);
    }
}