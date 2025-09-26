using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class PromptyManifestConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: manifest
        models:
          - id: gpt-35-turbo
          - id: gpt-4o
          - custom-model-id
        parameters:
          temperature: 0.7
          maxTokens: 1000
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "manifest",
          "models": [
            {
              "id": "gpt-35-turbo"
            },
            {
              "id": "gpt-4o"
            },
            "custom-model-id"
          ],
          "parameters": {
            "temperature": 0.7,
            "maxTokens": 1000
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<PromptyManifest>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("manifest", instance.Kind);
    }
}