using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class SessionWarningPayloadConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
warningType: remote
message: Remote session disabled

""";

        var instance = SessionWarningPayload.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("remote", instance.WarningType);
        Assert.Equal("Remote session disabled", instance.Message);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "warningType": "remote",
  "message": "Remote session disabled"
}
""";

        var instance = SessionWarningPayload.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("remote", instance.WarningType);
        Assert.Equal("Remote session disabled", instance.Message);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "warningType": "remote",
  "message": "Remote session disabled"
}
""";

        var original = SessionWarningPayload.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = SessionWarningPayload.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("remote", reloaded.WarningType);
        Assert.Equal("Remote session disabled", reloaded.Message);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
warningType: remote
message: Remote session disabled

""";

        var original = SessionWarningPayload.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = SessionWarningPayload.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("remote", reloaded.WarningType);
        Assert.Equal("Remote session disabled", reloaded.Message);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "warningType": "remote",
  "message": "Remote session disabled"
}
""";

        var instance = SessionWarningPayload.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
warningType: remote
message: Remote session disabled

""";

        var instance = SessionWarningPayload.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
