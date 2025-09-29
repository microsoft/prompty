using Xunit;
using System.Text.Json;
using YamlDotNet.Serialization;

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


        var serializer = new DeserializerBuilder().Build();
        var instance = serializer.Deserialize<ReferenceConnection>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("reference", instance.Kind);
        Assert.Equal("my-reference-connection", instance.Name);
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