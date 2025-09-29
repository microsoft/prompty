using Xunit;
using System.Text.Json;
using YamlDotNet.Serialization;

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


        var serializer = new DeserializerBuilder().Build();
        var instance = serializer.Deserialize<BingSearchConfiguration>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("my-configuration", instance.Name);
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