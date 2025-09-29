using Xunit;
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class RegistryConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: docker
        connection:
          kind: key
          authority: system
          usageDescription: Access to the container registry
        
        """;


        var serializer = new DeserializerBuilder().Build();
        var instance = serializer.Deserialize<Registry>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("docker", instance.Kind);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "docker",
          "connection": {
            "kind": "key",
            "authority": "system",
            "usageDescription": "Access to the container registry"
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<Registry>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("docker", instance.Kind);
    }
}