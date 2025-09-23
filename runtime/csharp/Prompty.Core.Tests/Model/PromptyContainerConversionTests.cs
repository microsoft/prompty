using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
#pragma warning restore IDE0130


public class PromptyContainerConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: container
        protocol: responses
        container:
          image: my-container-image
          registry:
            kind: acr
            subscription: my-subscription-id
        environmentVariables:
          MY_ENV_VAR: my-value
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "container",
          "protocol": "responses",
          "container": {
            "image": "my-container-image",
            "registry": {
              "kind": "acr",
              "subscription": "my-subscription-id"
            }
          },
          "environmentVariables": {
            "MY_ENV_VAR": "my-value"
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<PromptyContainer>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.kind, "container");
        Assert.Equal(instance.protocol, "responses");
    }
}