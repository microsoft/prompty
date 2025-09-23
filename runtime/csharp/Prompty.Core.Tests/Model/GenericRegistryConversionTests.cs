using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
#pragma warning restore IDE0130


public class GenericRegistryConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: some-value
        repository: https://my-registry.com
        username: my-username
        password: my-password
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "some-value",
          "repository": "https://my-registry.com",
          "username": "my-username",
          "password": "my-password"
        }
        """;

        var instance = JsonSerializer.Deserialize<GenericRegistry>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.kind, "some-value");
        Assert.Equal(instance.repository, "https://my-registry.com");
        Assert.Equal(instance.username, "my-username");
        Assert.Equal(instance.password, "my-password");
    }
}