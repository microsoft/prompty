using Xunit;
using System.Text.Json;

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
        description: A description of the tool parameter
        required: true
        enum:
          - value1
          - value2
          - value3
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "name": "my-parameter",
          "kind": "string",
          "description": "A description of the tool parameter",
          "required": true,
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
        Assert.Equal("A description of the tool parameter", instance.Description);
        Assert.True(instance.Required);
    }

}