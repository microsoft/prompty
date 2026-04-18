using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class TraceSpanConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
name: prompty.core.pipeline.run
signature: prompty.core.pipeline.run
error: Connection refused

""";

        var instance = TraceSpan.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("prompty.core.pipeline.run", instance.Name);
        Assert.Equal("prompty.core.pipeline.run", instance.Signature);
        Assert.Equal("Connection refused", instance.Error);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "name": "prompty.core.pipeline.run",
  "signature": "prompty.core.pipeline.run",
  "error": "Connection refused"
}
""";

        var instance = TraceSpan.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("prompty.core.pipeline.run", instance.Name);
        Assert.Equal("prompty.core.pipeline.run", instance.Signature);
        Assert.Equal("Connection refused", instance.Error);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "name": "prompty.core.pipeline.run",
  "signature": "prompty.core.pipeline.run",
  "error": "Connection refused"
}
""";

        var original = TraceSpan.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = TraceSpan.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("prompty.core.pipeline.run", reloaded.Name);
        Assert.Equal("prompty.core.pipeline.run", reloaded.Signature);
        Assert.Equal("Connection refused", reloaded.Error);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
name: prompty.core.pipeline.run
signature: prompty.core.pipeline.run
error: Connection refused

""";

        var original = TraceSpan.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = TraceSpan.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("prompty.core.pipeline.run", reloaded.Name);
        Assert.Equal("prompty.core.pipeline.run", reloaded.Signature);
        Assert.Equal("Connection refused", reloaded.Error);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "name": "prompty.core.pipeline.run",
  "signature": "prompty.core.pipeline.run",
  "error": "Connection refused"
}
""";

        var instance = TraceSpan.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
name: prompty.core.pipeline.run
signature: prompty.core.pipeline.run
error: Connection refused

""";

        var instance = TraceSpan.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
