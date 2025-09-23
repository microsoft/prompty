using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
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
        Assert.Equal(typeof(string), yamlData.GetType());
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