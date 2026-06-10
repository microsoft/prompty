using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class RedactedFieldConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
path: $.arguments.apiKey
mode: redacted
reason: secret

""";

        var instance = RedactedField.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("$.arguments.apiKey", instance.Path);
        Assert.Equal(RedactionMode.Redacted, instance.Mode);
        Assert.Equal("secret", instance.Reason);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "path": "$.arguments.apiKey",
  "mode": "redacted",
  "reason": "secret"
}
""";

        var instance = RedactedField.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("$.arguments.apiKey", instance.Path);
        Assert.Equal(RedactionMode.Redacted, instance.Mode);
        Assert.Equal("secret", instance.Reason);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "path": "$.arguments.apiKey",
  "mode": "redacted",
  "reason": "secret"
}
""";

        var original = RedactedField.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = RedactedField.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("$.arguments.apiKey", reloaded.Path);
        Assert.Equal(RedactionMode.Redacted, reloaded.Mode);
        Assert.Equal("secret", reloaded.Reason);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
path: $.arguments.apiKey
mode: redacted
reason: secret

""";

        var original = RedactedField.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = RedactedField.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("$.arguments.apiKey", reloaded.Path);
        Assert.Equal(RedactionMode.Redacted, reloaded.Mode);
        Assert.Equal("secret", reloaded.Reason);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "path": "$.arguments.apiKey",
  "mode": "redacted",
  "reason": "secret"
}
""";

        var instance = RedactedField.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
path: $.arguments.apiKey
mode: redacted
reason: secret

""";

        var instance = RedactedField.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
