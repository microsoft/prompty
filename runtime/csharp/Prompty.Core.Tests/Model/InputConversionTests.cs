using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class InputConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        name: my-input
        kind: string
        description: A description of the input property
        required: true
        strict: true
        default: default value
        sample: sample value
        
        """;

        var instance = YamlSerializer.Deserialize<Input>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("my-input", instance.Name);
        Assert.Equal("string", instance.Kind);
        Assert.Equal("A description of the input property", instance.Description);
        Assert.True(instance.Required);
        Assert.True(instance.Strict);
        Assert.Equal("default value", instance.Default);
        Assert.Equal("sample value", instance.Sample);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "name": "my-input",
          "kind": "string",
          "description": "A description of the input property",
          "required": true,
          "strict": true,
          "default": "default value",
          "sample": "sample value"
        }
        """;

        var instance = JsonSerializer.Deserialize<Input>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("my-input", instance.Name);
        Assert.Equal("string", instance.Kind);
        Assert.Equal("A description of the input property", instance.Description);
        Assert.True(instance.Required);
        Assert.True(instance.Strict);
        Assert.Equal("default value", instance.Default);
        Assert.Equal("sample value", instance.Sample);
    }
    [Fact]
    public void LoadJsonFromBoolean()
    {
        // alternate representation as boolean
        var data = false;
        var instance = JsonSerializer.Deserialize<Input>(data);
        Assert.NotNull(instance);
        Assert.Equal("boolean", instance.Kind);
        Assert.NotNull(instance.Sample);
        Assert.IsType<bool>(instance.Sample);
        Assert.False((bool)instance.Sample);
    }


    [Fact]
    public void LoadYamlFromBoolean()
    {
        // alternate representation as boolean
        var data = false;
        var instance = YamlSerializer.Deserialize<Input>(data);
        Assert.NotNull(instance);
        Assert.Equal("boolean", instance.Kind);
        Assert.NotNull(instance.Sample);
        Assert.IsType<bool>(instance.Sample);
        Assert.False((bool)instance.Sample);
    }
    [Fact]
    public void LoadJsonFromFloat32()
    {
        // alternate representation as float32
        var data = 3.14;
        var instance = JsonSerializer.Deserialize<Input>(data);
        Assert.NotNull(instance);
        Assert.Equal("float", instance.Kind);
        Assert.IsType<float>(instance.Sample);
        Assert.Equal(3.14, (float)instance.Sample, precision: 5);
    }


    [Fact]
    public void LoadYamlFromFloat32()
    {
        // alternate representation as float32
        var data = 3.14;
        var instance = YamlSerializer.Deserialize<Input>(data);
        Assert.NotNull(instance);
        Assert.Equal("float", instance.Kind);
        Assert.IsType<float>(instance.Sample);
        Assert.Equal(3.14, (float)instance.Sample, precision: 5);
    }
    [Fact]
    public void LoadJsonFromInteger()
    {
        // alternate representation as integer
        var data = 3;
        var instance = JsonSerializer.Deserialize<Input>(data);
        Assert.NotNull(instance);
        Assert.Equal("integer", instance.Kind);
        Assert.Equal(3, instance.Sample);
    }


    [Fact]
    public void LoadYamlFromInteger()
    {
        // alternate representation as integer
        var data = 3;
        var instance = YamlSerializer.Deserialize<Input>(data);
        Assert.NotNull(instance);
        Assert.Equal("integer", instance.Kind);
        Assert.Equal(3, instance.Sample);
    }
    [Fact]
    public void LoadJsonFromString()
    {
        // alternate representation as string
        var data = "\"example\"";
        var instance = JsonSerializer.Deserialize<Input>(data);
        Assert.NotNull(instance);
        Assert.Equal("string", instance.Kind);
        Assert.Equal("example", instance.Sample);
    }


    [Fact]
    public void LoadYamlFromString()
    {
        // alternate representation as string
        var data = "\"example\"";
        var instance = YamlSerializer.Deserialize<Input>(data);
        Assert.NotNull(instance);
        Assert.Equal("string", instance.Kind);
        Assert.Equal("example", instance.Sample);
    }

}