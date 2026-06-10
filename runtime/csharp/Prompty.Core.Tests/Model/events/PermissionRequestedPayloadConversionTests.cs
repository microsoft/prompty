using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class PermissionRequestedPayloadConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
permission: tool.execute
target: shell

""";

        var instance = PermissionRequestedPayload.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("tool.execute", instance.Permission);
        Assert.Equal("shell", instance.Target);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "permission": "tool.execute",
  "target": "shell"
}
""";

        var instance = PermissionRequestedPayload.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("tool.execute", instance.Permission);
        Assert.Equal("shell", instance.Target);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "permission": "tool.execute",
  "target": "shell"
}
""";

        var original = PermissionRequestedPayload.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = PermissionRequestedPayload.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("tool.execute", reloaded.Permission);
        Assert.Equal("shell", reloaded.Target);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
permission: tool.execute
target: shell

""";

        var original = PermissionRequestedPayload.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = PermissionRequestedPayload.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("tool.execute", reloaded.Permission);
        Assert.Equal("shell", reloaded.Target);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "permission": "tool.execute",
  "target": "shell"
}
""";

        var instance = PermissionRequestedPayload.FromJson(jsonData);
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
target: shell

""";

        var instance = PermissionRequestedPayload.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
