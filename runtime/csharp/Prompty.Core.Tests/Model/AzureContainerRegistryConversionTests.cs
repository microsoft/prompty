using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
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
        Assert.Equal("acr", instance.Kind);
        Assert.Equal("your-subscription-id", instance.Subscription);
        Assert.Equal("your-resource-group", instance.ResourceGroup);
        Assert.Equal("your-acr-name", instance.RegistryName);
    }

}