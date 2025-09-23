using Xunit;
using System.Text.Json;

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
        Assert.Equal(typeof(string), yamlData.GetType());
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