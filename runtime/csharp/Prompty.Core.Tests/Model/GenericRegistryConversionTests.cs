using Xunit;
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
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


        var serializer = new DeserializerBuilder().Build();
        var instance = serializer.Deserialize<GenericRegistry>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("some-value", instance.Kind);
        Assert.Equal("https://my-registry.com", instance.Repository);
        Assert.Equal("my-username", instance.Username);
        Assert.Equal("my-password", instance.Password);
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
        Assert.Equal("some-value", instance.Kind);
        Assert.Equal("https://my-registry.com", instance.Repository);
        Assert.Equal("my-username", instance.Username);
        Assert.Equal("my-password", instance.Password);
    }
}