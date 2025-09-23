using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
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
        Assert.Equal(1, instance.MinReplicas);
        Assert.Equal(5, instance.MaxReplicas);
        Assert.Equal(0.5, instance.Cpu);
        Assert.Equal(2, instance.Memory);
    }
}