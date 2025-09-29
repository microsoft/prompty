using Xunit;
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
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


        var serializer = new DeserializerBuilder().Build();
        var instance = serializer.Deserialize<ObjectOutput>(yamlData);

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

        var instance = JsonSerializer.Deserialize<ObjectOutput>(jsonData);
        Assert.NotNull(instance);
    }
}