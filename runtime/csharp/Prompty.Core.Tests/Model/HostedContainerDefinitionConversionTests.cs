using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class HostedContainerDefinitionConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        scale:
          minReplicas: 1
          maxReplicas: 5
          cpu: 0.5
          memory: 2
        context:
          dockerfile: dockerfile
          buildContext: .
        
        """;

        var instance = YamlSerializer.Deserialize<HostedContainerDefinition>(yamlData);

        Assert.NotNull(instance);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "scale": {
            "minReplicas": 1,
            "maxReplicas": 5,
            "cpu": 0.5,
            "memory": 2
          },
          "context": {
            "dockerfile": "dockerfile",
            "buildContext": "."
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<HostedContainerDefinition>(jsonData);
        Assert.NotNull(instance);
    }
}