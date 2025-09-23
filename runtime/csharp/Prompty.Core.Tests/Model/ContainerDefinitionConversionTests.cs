using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
#pragma warning restore IDE0130


public class ContainerDefinitionConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        image: my-container-image
        tag: v1.0.0
        registry:
          kind: acr
          connection:
            kind: key
            authority: system
            usageDescription: Access to the container registry
        scale:
          minReplicas: 1
          maxReplicas: 5
          cpu: 0.5
          memory: 2
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "image": "my-container-image",
          "tag": "v1.0.0",
          "registry": {
            "kind": "acr",
            "connection": {
              "kind": "key",
              "authority": "system",
              "usageDescription": "Access to the container registry"
            }
          },
          "scale": {
            "minReplicas": 1,
            "maxReplicas": 5,
            "cpu": 0.5,
            "memory": 2
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<ContainerDefinition>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.image, "my-container-image");
        Assert.Equal(instance.tag, "v1.0.0");
    }
}