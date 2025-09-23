using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
#pragma warning restore IDE0130


public class FoundryConnectionConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: foundry
        type: index
        name: my-foundry-connection
        project: my-foundry-project
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "foundry",
          "type": "index",
          "name": "my-foundry-connection",
          "project": "my-foundry-project"
        }
        """;

        var instance = JsonSerializer.Deserialize<FoundryConnection>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.kind, "foundry");
        Assert.Equal(instance.type, "index");
        Assert.Equal(instance.name, "my-foundry-connection");
        Assert.Equal(instance.project, "my-foundry-project");
    }
}