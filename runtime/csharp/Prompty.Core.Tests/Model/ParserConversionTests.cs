using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
#pragma warning restore IDE0130


public class ParserConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: prompty
        options:
          key: value
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "prompty",
          "options": {
            "key": "value"
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<Parser>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.kind, "prompty");
    }
}