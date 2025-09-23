using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
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
        Assert.Equal(instance.name, "my-tool");
        Assert.Equal(instance.input, "input-variable");
    }
}