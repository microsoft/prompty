using System.Text.Json;


namespace Prompty.Core.Tests;


public class YamlConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yaml_data = """
    name: my-input
    kind: string
    description: A description of the input property
    required: true
    strict: true
    default: default value
    sample: sample value
    """;
        Assert.Equal(typeof(string), yaml_data.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string json_data = """
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

        var input = JsonSerializer.Deserialize<Input>(json_data);
        Assert.Equal(typeof(string), json_data.GetType());
        Assert.NotNull(input);
        Assert.True(input.Strict);
    }
}
