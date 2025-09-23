using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
#pragma warning restore IDE0130


public class OutputConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        name: my-output
        kind: string
        description: A description of the output property
        required: true
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "name": "my-output",
          "kind": "string",
          "description": "A description of the output property",
          "required": true
        }
        """;

        var instance = JsonSerializer.Deserialize<Output>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.name, "my-output");
        Assert.Equal(instance.kind, "string");
        Assert.Equal(instance.description, "A description of the output property");
        Assert.True(instance.required);
    }
}