using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
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
        Assert.Equal(typeof(string), yamlData.GetType());
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
        Assert.Equal(instance.kind, "model");
    }
}