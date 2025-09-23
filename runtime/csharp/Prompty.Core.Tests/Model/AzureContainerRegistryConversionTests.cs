using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
#pragma warning restore IDE0130


public class AzureContainerRegistryConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: acr
        subscription: your-subscription-id
        resourceGroup: your-resource-group
        registryName: your-acr-name
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "acr",
          "subscription": "your-subscription-id",
          "resourceGroup": "your-resource-group",
          "registryName": "your-acr-name"
        }
        """;

        var instance = JsonSerializer.Deserialize<AzureContainerRegistry>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.kind, "acr");
        Assert.Equal(instance.subscription, "your-subscription-id");
        Assert.Equal(instance.resourceGroup, "your-resource-group");
        Assert.Equal(instance.registryName, "your-acr-name");
    }
}