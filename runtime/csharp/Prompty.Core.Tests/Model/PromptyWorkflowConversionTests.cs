using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class PromptyWorkflowConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: workflow
        
        """;

        var instance = YamlSerializer.Deserialize<PromptyWorkflow>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("workflow", instance.Kind);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "workflow"
        }
        """;

        var instance = JsonSerializer.Deserialize<PromptyWorkflow>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("workflow", instance.Kind);
    }
}