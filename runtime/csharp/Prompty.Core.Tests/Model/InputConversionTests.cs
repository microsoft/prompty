using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
#pragma warning restore IDE0130


public class InputConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        name: my-input
        kind: string
        description: A description of the input property
        required: true
        strict: true
        default: default value
        sample: sample value
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "name": "my-input",
          "kind": "string",
          "description": "A description of the input property",
          "required": true,
          "strict": true,
          "default": "default value",
          "sample": "sample value"
        }
        """;

        var instance = JsonSerializer.Deserialize<Input>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.name, "my-input");
        Assert.Equal(instance.kind, "string");
        Assert.Equal(instance.description, "A description of the input property");
        Assert.True(instance.required);
        Assert.True(instance.strict);
        Assert.Equal(instance.default, "default value");
        Assert.Equal(instance.sample, "sample value");
    }
}