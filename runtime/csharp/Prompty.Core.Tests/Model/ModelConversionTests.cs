using Xunit;
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ModelConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        id: gpt-35-turbo
        publisher: azure
        connection:
          kind: key
          endpoint: https://{your-custom-endpoint}.openai.azure.com/
          key: "{your-api-key}"
        options:
          type: chat
          temperature: 0.7
          maxTokens: 1000
        
        """;


        var serializer = new DeserializerBuilder().Build();
        var instance = serializer.Deserialize<Model>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("gpt-35-turbo", instance.Id);
        Assert.Equal("azure", instance.Publisher);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "id": "gpt-35-turbo",
          "publisher": "azure",
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
        Assert.Equal("gpt-35-turbo", instance.Id);
        Assert.Equal("azure", instance.Publisher);
    }
    [Fact]
    public void LoadJsonFromString()
    {
        // alternate representation as string
        var data = "\"example\"";
        var instance = JsonSerializer.Deserialize<Model>(data);
        Assert.NotNull(instance);
        Assert.Equal("example", instance.Id);
    }


    [Fact]
    public void LoadYamlFromString()
    {
        // alternate representation as string
        var data = "\"example\"";
        var serializer = new DeserializerBuilder().Build();
        var instance = serializer.Deserialize<Model>(data.ToString());
        Assert.NotNull(instance);
        Assert.Equal("example", instance.Id);
    }

}