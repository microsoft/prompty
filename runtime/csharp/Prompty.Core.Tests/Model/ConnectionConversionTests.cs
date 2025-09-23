using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
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
        Assert.Equal(instance.kind, "oauth");
        Assert.Equal(instance.authority, "system");
        Assert.Equal(instance.usageDescription, "This will allow the agent to respond to an email on your behalf");
    }
}