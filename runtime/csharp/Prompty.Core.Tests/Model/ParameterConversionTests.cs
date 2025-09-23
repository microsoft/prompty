using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
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
        Assert.Equal(instance.name, "my-parameter");
        Assert.Equal(instance.kind, "string");
        Assert.Equal(instance.description, "A description of the tool parameter");
        Assert.True(instance.required);
    }
}