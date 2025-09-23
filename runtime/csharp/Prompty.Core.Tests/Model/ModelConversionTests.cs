using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
#pragma warning restore IDE0130


public class ModelConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        id: gpt-35-turbo
        provider: azure
        connection:
          kind: key
          endpoint: https://{your-custom-endpoint}.openai.azure.com/
          key: "{your-api-key}"
        options:
          type: chat
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
          "id": "gpt-35-turbo",
          "provider": "azure",
          "connection": {
            "kind": "key",
            "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
            "key": "{your-api-key}"
          },
          "options": {
            "type": "chat",
            "temperature": 0.7,
            "maxTokens": 1000
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<Model>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.id, "gpt-35-turbo");
        Assert.Equal(instance.provider, "azure");
    }
}