using Xunit;
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class TemplateConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        format:
          kind: mustache
        parser:
          kind: mustache
        
        """;


        var serializer = new DeserializerBuilder().Build();
        var instance = serializer.Deserialize<Template>(yamlData);

        Assert.NotNull(instance);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "format": {
            "kind": "mustache"
          },
          "parser": {
            "kind": "mustache"
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<Template>(jsonData);
        Assert.NotNull(instance);
    }
}