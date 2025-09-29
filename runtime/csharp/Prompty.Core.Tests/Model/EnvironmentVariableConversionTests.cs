using Xunit;
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class EnvironmentVariableConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        name: MY_ENV_VAR
        value: my-value
        
        """;


        var serializer = new DeserializerBuilder().Build();
        var instance = serializer.Deserialize<EnvironmentVariable>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("MY_ENV_VAR", instance.Name);
        Assert.Equal("my-value", instance.Value);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "name": "MY_ENV_VAR",
          "value": "my-value"
        }
        """;

        var instance = JsonSerializer.Deserialize<EnvironmentVariable>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("MY_ENV_VAR", instance.Name);
        Assert.Equal("my-value", instance.Value);
    }
    [Fact]
    public void LoadJsonFromString()
    {
        // alternate representation as string
        var data = "\"example\"";
        var instance = JsonSerializer.Deserialize<EnvironmentVariable>(data);
        Assert.NotNull(instance);
        Assert.Equal("example", instance.Value);
    }


    [Fact]
    public void LoadYamlFromString()
    {
        // alternate representation as string
        var data = "\"example\"";
        var serializer = new DeserializerBuilder().Build();
        var instance = serializer.Deserialize<EnvironmentVariable>(data.ToString());
        Assert.NotNull(instance);
        Assert.Equal("example", instance.Value);
    }

}