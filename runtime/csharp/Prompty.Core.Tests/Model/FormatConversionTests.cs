using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
#pragma warning restore IDE0130


public class FormatConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: mustache
        strict: true
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
          "kind": "mustache",
          "strict": true,
          "options": {
            "key": "value"
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<Format>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.kind, "mustache");
        Assert.True(instance.strict);
    }
}