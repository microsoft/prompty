
using Xunit;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130


public class PropertyConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
name: my-input
kind: string
description: A description of the input property
required: true
default: default value
example: example value
enumValues:
  - value1
  - value2
  - value3

""";

        var instance = Property.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("my-input", instance.Name);
        Assert.Equal("string", instance.Kind);
        Assert.Equal("A description of the input property", instance.Description);
        Assert.True(instance.Required);
        Assert.Equal("default value", instance.Default);
        Assert.Equal("example value", instance.Example);
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
  "default": "default value",
  "example": "example value",
  "enumValues": [
    "value1",
    "value2",
    "value3"
  ]
}
""";

        var instance = Property.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("my-input", instance.Name);
        Assert.Equal("string", instance.Kind);
        Assert.Equal("A description of the input property", instance.Description);
        Assert.True(instance.Required);
        Assert.Equal("default value", instance.Default);
        Assert.Equal("example value", instance.Example);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "name": "my-input",
  "kind": "string",
  "description": "A description of the input property",
  "required": true,
  "default": "default value",
  "example": "example value",
  "enumValues": [
    "value1",
    "value2",
    "value3"
  ]
}
""";

        var original = Property.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = Property.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("my-input", reloaded.Name);
        Assert.Equal("string", reloaded.Kind);
        Assert.Equal("A description of the input property", reloaded.Description);
        Assert.True(reloaded.Required);
        Assert.Equal("default value", reloaded.Default);
        Assert.Equal("example value", reloaded.Example);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
name: my-input
kind: string
description: A description of the input property
required: true
default: default value
example: example value
enumValues:
  - value1
  - value2
  - value3

""";

        var original = Property.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = Property.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("my-input", reloaded.Name);
        Assert.Equal("string", reloaded.Kind);
        Assert.Equal("A description of the input property", reloaded.Description);
        Assert.True(reloaded.Required);
        Assert.Equal("default value", reloaded.Default);
        Assert.Equal("example value", reloaded.Example);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "name": "my-input",
  "kind": "string",
  "description": "A description of the input property",
  "required": true,
  "default": "default value",
  "example": "example value",
  "enumValues": [
    "value1",
    "value2",
    "value3"
  ]
}
""";

        var instance = Property.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
name: my-input
kind: string
description: A description of the input property
required: true
default: default value
example: example value
enumValues:
  - value1
  - value2
  - value3

""";

        var instance = Property.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
    [Fact]
    public void LoadJsonFromBoolean()
    {
        // alternate representation as boolean
        var data = "false";
        var instance = Property.FromJson(data);
        Assert.NotNull(instance);
        Assert.Equal("boolean", instance.Kind);
        Assert.NotNull(instance.Example);
        Assert.IsType<bool>(instance.Example);
        Assert.False((bool)instance.Example);
    }


    [Fact]
    public void LoadYamlFromBoolean()
    {
        // alternate representation as boolean
        var data = "false";
        var instance = Property.FromYaml(data);
        Assert.NotNull(instance);
        Assert.Equal("boolean", instance.Kind);
        Assert.NotNull(instance.Example);
        Assert.IsType<bool>(instance.Example);
        Assert.False((bool)instance.Example);
    }
    [Fact]
    public void LoadJsonFromFloat32()
    {
        // alternate representation as float32
        var data = "3.14";
        var instance = Property.FromJson(data);
        Assert.NotNull(instance);
        Assert.Equal("float", instance.Kind);
        Assert.NotNull(instance.Example);
        Assert.True(instance.Example is float || instance.Example is double || instance.Example is int || instance.Example is long);
        Assert.Equal(3.14, Convert.ToDouble(instance.Example), 5);
    }


    [Fact]
    public void LoadYamlFromFloat32()
    {
        // alternate representation as float32
        var data = "3.14";
        var instance = Property.FromYaml(data);
        Assert.NotNull(instance);
        Assert.Equal("float", instance.Kind);
        Assert.NotNull(instance.Example);
        Assert.True(instance.Example is float || instance.Example is double || instance.Example is int || instance.Example is long);
        Assert.Equal(3.14, Convert.ToDouble(instance.Example), 5);
    }
    [Fact]
    public void LoadJsonFromInteger()
    {
        // alternate representation as integer
        var data = "4";
        var instance = Property.FromJson(data);
        Assert.NotNull(instance);
        Assert.Equal("integer", instance.Kind);
        Assert.Equal(4, instance.Example);
    }


    [Fact]
    public void LoadYamlFromInteger()
    {
        // alternate representation as integer
        var data = "4";
        var instance = Property.FromYaml(data);
        Assert.NotNull(instance);
        Assert.Equal("integer", instance.Kind);
        Assert.Equal(4, instance.Example);
    }
    [Fact]
    public void LoadJsonFromString()
    {
        // alternate representation as string
        var data = "\"example\"";
        var instance = Property.FromJson(data);
        Assert.NotNull(instance);
        Assert.Equal("string", instance.Kind);
        Assert.Equal("example", instance.Example);
    }


    [Fact]
    public void LoadYamlFromString()
    {
        // alternate representation as string
        var data = "\"example\"";
        var instance = Property.FromYaml(data);
        Assert.NotNull(instance);
        Assert.Equal("string", instance.Kind);
        Assert.Equal("example", instance.Example);
    }
    
}
