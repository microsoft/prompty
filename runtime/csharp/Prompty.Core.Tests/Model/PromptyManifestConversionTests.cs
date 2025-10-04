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
        models:
          - id: gpt-35-turbo
          - id: gpt-4o
          - custom-model-id
        parameters:
          param1:
            kind: string
          param2:
            kind: number
        
        """;

        var instance = YamlSerializer.Deserialize<PromptyManifest>(yamlData);

        Assert.NotNull(instance);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
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
            "param1": {
              "kind": "string"
            },
            "param2": {
              "kind": "number"
            }
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<PromptyManifest>(jsonData);
        Assert.NotNull(instance);
    }
}