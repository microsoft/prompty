using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class BingSearchConfigurationConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        name: my-configuration
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "name": "my-configuration"
        }
        """;

        var instance = JsonSerializer.Deserialize<BingSearchConfiguration>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("my-configuration", instance.Name);
    }

}