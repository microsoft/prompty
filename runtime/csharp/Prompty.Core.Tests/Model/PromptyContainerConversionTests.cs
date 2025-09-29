using Xunit;
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
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


        var serializer = new DeserializerBuilder().Build();
        var instance = serializer.Deserialize<PromptyContainer>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("container", instance.Kind);
        Assert.Equal("responses", instance.Protocol);
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
        Assert.Equal("container", instance.Kind);
        Assert.Equal("responses", instance.Protocol);
    }
}