using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class PromptyHostedContainerConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: hosted
        protocol: responses
        container:
          scale:
            minReplicas: 1
            maxReplicas: 5
            cpu: 0.5
            memory: 2
        context:
          dockerfile: dockerfile
          buildContext: .
        environmentVariables:
          MY_ENV_VAR: my-value
        
        """;

        var instance = YamlSerializer.Deserialize<PromptyHostedContainer>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("hosted", instance.Kind);
        Assert.Equal("responses", instance.Protocol);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "hosted",
          "protocol": "responses",
          "container": {
            "scale": {
              "minReplicas": 1,
              "maxReplicas": 5,
              "cpu": 0.5,
              "memory": 2
            }
          },
          "context": {
            "dockerfile": "dockerfile",
            "buildContext": "."
          },
          "environmentVariables": {
            "MY_ENV_VAR": "my-value"
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<PromptyHostedContainer>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("hosted", instance.Kind);
        Assert.Equal("responses", instance.Protocol);
    }
}