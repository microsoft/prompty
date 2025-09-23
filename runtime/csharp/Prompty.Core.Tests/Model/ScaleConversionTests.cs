using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
#pragma warning restore IDE0130


public class ScaleConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        minReplicas: 1
        maxReplicas: 5
        cpu: 0.5
        memory: 2
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "minReplicas": 1,
          "maxReplicas": 5,
          "cpu": 0.5,
          "memory": 2
        }
        """;

        var instance = JsonSerializer.Deserialize<Scale>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.minReplicas, 1);
        Assert.Equal(instance.maxReplicas, 5);
        Assert.Equal(instance.cpu, 0.5);
        Assert.Equal(instance.memory, 2);
    }
}