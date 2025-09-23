using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ReferenceConnectionConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: reference
        name: my-reference-connection
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "reference",
          "name": "my-reference-connection"
        }
        """;

        var instance = JsonSerializer.Deserialize<ReferenceConnection>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("reference", instance.Kind);
        Assert.Equal("my-reference-connection", instance.Name);
    }
}