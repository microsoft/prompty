using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
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
        Assert.Equal(typeof(string), yamlData.GetType());
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
        Assert.Equal(instance.kind, "docker");
    }
}