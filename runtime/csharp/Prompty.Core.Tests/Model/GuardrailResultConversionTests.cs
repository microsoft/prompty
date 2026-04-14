
using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class GuardrailResultConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
allowed: true
reason: Content is safe

""";

        var instance = GuardrailResult.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.True(instance.Allowed);
        Assert.Equal("Content is safe", instance.Reason);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "allowed": true,
  "reason": "Content is safe"
}
""";

        var instance = GuardrailResult.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.True(instance.Allowed);
        Assert.Equal("Content is safe", instance.Reason);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "allowed": true,
  "reason": "Content is safe"
}
""";

        var original = GuardrailResult.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = GuardrailResult.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.True(reloaded.Allowed);
        Assert.Equal("Content is safe", reloaded.Reason);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
allowed: true
reason: Content is safe

""";

        var original = GuardrailResult.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = GuardrailResult.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.True(reloaded.Allowed);
        Assert.Equal("Content is safe", reloaded.Reason);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "allowed": true,
  "reason": "Content is safe"
}
""";

        var instance = GuardrailResult.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
allowed: true
reason: Content is safe

""";

        var instance = GuardrailResult.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
