using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class PromptyConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: prompt
        model:
          id: gpt-35-turbo
          connection:
            kind: key
            endpoint: https://{your-custom-endpoint}.openai.azure.com/
            key: "{your-api-key}"
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "prompt",
          "model": {
            "id": "gpt-35-turbo",
            "connection": {
              "kind": "key",
              "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
              "key": "{your-api-key}"
            }
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<Prompty>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("prompt", instance.Kind);
    }
}