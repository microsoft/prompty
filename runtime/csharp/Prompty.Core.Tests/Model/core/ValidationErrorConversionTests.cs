using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ValidationErrorConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
message: "Missing required input: firstName"
property: firstName
constraint: required

""";

        var instance = ValidationError.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("Missing required input: firstName", instance.Message);
        Assert.Equal("firstName", instance.Property);
        Assert.Equal("required", instance.Constraint);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "message": "Missing required input: firstName",
  "property": "firstName",
  "constraint": "required"
}
""";

        var instance = ValidationError.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("Missing required input: firstName", instance.Message);
        Assert.Equal("firstName", instance.Property);
        Assert.Equal("required", instance.Constraint);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "message": "Missing required input: firstName",
  "property": "firstName",
  "constraint": "required"
}
""";

        var original = ValidationError.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = ValidationError.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("Missing required input: firstName", reloaded.Message);
        Assert.Equal("firstName", reloaded.Property);
        Assert.Equal("required", reloaded.Constraint);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
message: "Missing required input: firstName"
property: firstName
constraint: required

""";

        var original = ValidationError.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = ValidationError.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("Missing required input: firstName", reloaded.Message);
        Assert.Equal("firstName", reloaded.Property);
        Assert.Equal("required", reloaded.Constraint);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "message": "Missing required input: firstName",
  "property": "firstName",
  "constraint": "required"
}
""";

        var instance = ValidationError.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
message: "Missing required input: firstName"
property: firstName
constraint: required

""";

        var instance = ValidationError.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
