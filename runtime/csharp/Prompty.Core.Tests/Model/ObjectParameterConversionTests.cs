using Xunit;
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
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


        var serializer = new DeserializerBuilder().Build();
        var instance = serializer.Deserialize<ObjectParameter>(yamlData);

        Assert.NotNull(instance);
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