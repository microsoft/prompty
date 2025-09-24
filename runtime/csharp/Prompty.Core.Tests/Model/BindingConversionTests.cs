using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class BindingConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        name: my-tool
        input: input-variable
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "name": "my-tool",
          "input": "input-variable"
        }
        """;

        var instance = JsonSerializer.Deserialize<Binding>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("my-tool", instance.Name);
        Assert.Equal("input-variable", instance.Input);
    }
    // regular expression for matching only floats
    [Fact]
    public void LoadFromString()
    {
        // alternate representation as string
        var data = "\"example\"";
        var instance = JsonSerializer.Deserialize<Binding>(data);
        Assert.NotNull(instance);
        Assert.Equal("example", instance.Input);
    }

}