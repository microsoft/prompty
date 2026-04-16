using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ThreadMarkerConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
name: thread
kind: thread

""";

        var instance = ThreadMarker.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("thread", instance.Name);
        Assert.Equal("thread", instance.Kind);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "name": "thread",
  "kind": "thread"
}
""";

        var instance = ThreadMarker.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("thread", instance.Name);
        Assert.Equal("thread", instance.Kind);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "name": "thread",
  "kind": "thread"
}
""";

        var original = ThreadMarker.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = ThreadMarker.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("thread", reloaded.Name);
        Assert.Equal("thread", reloaded.Kind);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
name: thread
kind: thread

""";

        var original = ThreadMarker.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = ThreadMarker.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("thread", reloaded.Name);
        Assert.Equal("thread", reloaded.Kind);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "name": "thread",
  "kind": "thread"
}
""";

        var instance = ThreadMarker.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
name: thread
kind: thread

""";

        var instance = ThreadMarker.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
