using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
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

        var instance = YamlSerializer.Deserialize<FoundryConnection>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("foundry", instance.Kind);
        Assert.Equal("index", instance.Type);
        Assert.Equal("my-foundry-connection", instance.Name);
        Assert.Equal("my-foundry-project", instance.Project);
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
        Assert.Equal("foundry", instance.Kind);
        Assert.Equal("index", instance.Type);
        Assert.Equal("my-foundry-connection", instance.Name);
        Assert.Equal("my-foundry-project", instance.Project);
    }
}