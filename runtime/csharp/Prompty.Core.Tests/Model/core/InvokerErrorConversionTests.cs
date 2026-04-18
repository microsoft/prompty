using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class InvokerErrorConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
message: "No renderer registered for key: jinja2"
component: renderer
key: jinja2

""";

        var instance = InvokerError.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("No renderer registered for key: jinja2", instance.Message);
        Assert.Equal("renderer", instance.Component);
        Assert.Equal("jinja2", instance.Key);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "message": "No renderer registered for key: jinja2",
  "component": "renderer",
  "key": "jinja2"
}
""";

        var instance = InvokerError.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("No renderer registered for key: jinja2", instance.Message);
        Assert.Equal("renderer", instance.Component);
        Assert.Equal("jinja2", instance.Key);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "message": "No renderer registered for key: jinja2",
  "component": "renderer",
  "key": "jinja2"
}
""";

        var original = InvokerError.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = InvokerError.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("No renderer registered for key: jinja2", reloaded.Message);
        Assert.Equal("renderer", reloaded.Component);
        Assert.Equal("jinja2", reloaded.Key);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
message: "No renderer registered for key: jinja2"
component: renderer
key: jinja2

""";

        var original = InvokerError.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = InvokerError.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("No renderer registered for key: jinja2", reloaded.Message);
        Assert.Equal("renderer", reloaded.Component);
        Assert.Equal("jinja2", reloaded.Key);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "message": "No renderer registered for key: jinja2",
  "component": "renderer",
  "key": "jinja2"
}
""";

        var instance = InvokerError.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
message: "No renderer registered for key: jinja2"
component: renderer
key: jinja2

""";

        var instance = InvokerError.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
