using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
#pragma warning restore IDE0130


public class KeyConnectionConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: key
        endpoint: https://{your-custom-endpoint}.openai.azure.com/
        key: your-api-key
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "key",
          "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
          "key": "your-api-key"
        }
        """;

        var instance = JsonSerializer.Deserialize<KeyConnection>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.kind, "key");
        Assert.Equal(instance.endpoint, "https://{your-custom-endpoint}.openai.azure.com/");
        Assert.Equal(instance.key, "your-api-key");
    }
}