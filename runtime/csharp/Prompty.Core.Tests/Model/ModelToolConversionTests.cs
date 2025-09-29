using Xunit;
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ModelToolConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: model
        model:
          id: my-model
          provider: my-provider
          connection:
            kind: provider-connection
        
        """;


        var serializer = new DeserializerBuilder().Build();
        var instance = serializer.Deserialize<ModelTool>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("model", instance.Kind);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "model",
          "model": {
            "id": "my-model",
            "provider": "my-provider",
            "connection": {
              "kind": "provider-connection"
            }
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<ModelTool>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("model", instance.Kind);
    }
}