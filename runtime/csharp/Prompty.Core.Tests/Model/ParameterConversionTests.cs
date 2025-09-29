using Xunit;
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ParameterConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        name: my-parameter
        kind: string
        description: A description of the parameter
        required: true
        default: default value
        value: sample value
        enum:
          - value1
          - value2
          - value3
        
        """;


        var serializer = new DeserializerBuilder().Build();
        var instance = serializer.Deserialize<Parameter>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("my-parameter", instance.Name);
        Assert.Equal("string", instance.Kind);
        Assert.Equal("A description of the parameter", instance.Description);
        Assert.True(instance.Required);
        Assert.Equal("default value", instance.Default);
        Assert.Equal("sample value", instance.Value);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "name": "my-parameter",
          "kind": "string",
          "description": "A description of the parameter",
          "required": true,
          "default": "default value",
          "value": "sample value",
          "enum": [
            "value1",
            "value2",
            "value3"
          ]
        }
        """;

        var instance = JsonSerializer.Deserialize<Parameter>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("my-parameter", instance.Name);
        Assert.Equal("string", instance.Kind);
        Assert.Equal("A description of the parameter", instance.Description);
        Assert.True(instance.Required);
        Assert.Equal("default value", instance.Default);
        Assert.Equal("sample value", instance.Value);
    }
}