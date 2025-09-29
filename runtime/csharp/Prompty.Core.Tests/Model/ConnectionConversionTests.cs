using Xunit;
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ConnectionConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: oauth
        authority: system
        usageDescription: This will allow the agent to respond to an email on your behalf
        
        """;


        var serializer = new DeserializerBuilder().Build();
        var instance = serializer.Deserialize<Connection>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("oauth", instance.Kind);
        Assert.Equal("system", instance.Authority);
        Assert.Equal("This will allow the agent to respond to an email on your behalf", instance.UsageDescription);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "oauth",
          "authority": "system",
          "usageDescription": "This will allow the agent to respond to an email on your behalf"
        }
        """;

        var instance = JsonSerializer.Deserialize<Connection>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("oauth", instance.Kind);
        Assert.Equal("system", instance.Authority);
        Assert.Equal("This will allow the agent to respond to an email on your behalf", instance.UsageDescription);
    }
}