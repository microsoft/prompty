using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class PermissionCompletedPayloadConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
permission: tool.execute
approved: true
reason: user_approved

""";

        var instance = PermissionCompletedPayload.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("tool.execute", instance.Permission);
        Assert.True(instance.Approved);
        Assert.Equal("user_approved", instance.Reason);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "permission": "tool.execute",
  "approved": true,
  "reason": "user_approved"
}
""";

        var instance = PermissionCompletedPayload.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("tool.execute", instance.Permission);
        Assert.True(instance.Approved);
        Assert.Equal("user_approved", instance.Reason);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "permission": "tool.execute",
  "approved": true,
  "reason": "user_approved"
}
""";

        var original = PermissionCompletedPayload.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = PermissionCompletedPayload.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("tool.execute", reloaded.Permission);
        Assert.True(reloaded.Approved);
        Assert.Equal("user_approved", reloaded.Reason);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
permission: tool.execute
approved: true
reason: user_approved

""";

        var original = PermissionCompletedPayload.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = PermissionCompletedPayload.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("tool.execute", reloaded.Permission);
        Assert.True(reloaded.Approved);
        Assert.Equal("user_approved", reloaded.Reason);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "permission": "tool.execute",
  "approved": true,
  "reason": "user_approved"
}
""";

        var instance = PermissionCompletedPayload.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
permission: tool.execute
approved: true
reason: user_approved

""";

        var instance = PermissionCompletedPayload.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
