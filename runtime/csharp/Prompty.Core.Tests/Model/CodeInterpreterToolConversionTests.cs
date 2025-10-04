using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class CodeInterpreterToolConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: code_interpreter
        fileIds:
          - file1
          - file2
        
        """;

        var instance = YamlSerializer.Deserialize<CodeInterpreterTool>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("code_interpreter", instance.Kind);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "code_interpreter",
          "fileIds": [
            "file1",
            "file2"
          ]
        }
        """;

        var instance = JsonSerializer.Deserialize<CodeInterpreterTool>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("code_interpreter", instance.Kind);
    }
}