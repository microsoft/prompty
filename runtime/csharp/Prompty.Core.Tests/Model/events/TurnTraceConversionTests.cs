using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class TurnTraceConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
version: "1"
runtime: typescript
promptyVersion: 2.0.0

""";

        var instance = TurnTrace.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("1", instance.Version);
        Assert.Equal("typescript", instance.Runtime);
        Assert.Equal("2.0.0", instance.PromptyVersion);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "version": "1",
  "runtime": "typescript",
  "promptyVersion": "2.0.0"
}
""";

        var instance = TurnTrace.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("1", instance.Version);
        Assert.Equal("typescript", instance.Runtime);
        Assert.Equal("2.0.0", instance.PromptyVersion);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "version": "1",
  "runtime": "typescript",
  "promptyVersion": "2.0.0"
}
""";

        var original = TurnTrace.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = TurnTrace.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("1", reloaded.Version);
        Assert.Equal("typescript", reloaded.Runtime);
        Assert.Equal("2.0.0", reloaded.PromptyVersion);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
version: "1"
runtime: typescript
promptyVersion: 2.0.0

""";

        var original = TurnTrace.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = TurnTrace.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("1", reloaded.Version);
        Assert.Equal("typescript", reloaded.Runtime);
        Assert.Equal("2.0.0", reloaded.PromptyVersion);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "version": "1",
  "runtime": "typescript",
  "promptyVersion": "2.0.0"
}
""";

        var instance = TurnTrace.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
version: "1"
runtime: typescript
promptyVersion: 2.0.0

""";

        var instance = TurnTrace.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
