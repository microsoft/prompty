using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ValidationResultConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
valid: true
errors: []

""";

        var instance = ValidationResult.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.True(instance.Valid);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "valid": true,
  "errors": []
}
""";

        var instance = ValidationResult.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.True(instance.Valid);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "valid": true,
  "errors": []
}
""";

        var original = ValidationResult.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = ValidationResult.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.True(reloaded.Valid);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
valid: true
errors: []

""";

        var original = ValidationResult.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = ValidationResult.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.True(reloaded.Valid);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "valid": true,
  "errors": []
}
""";

        var instance = ValidationResult.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
valid: true
errors: []

""";

        var instance = ValidationResult.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
