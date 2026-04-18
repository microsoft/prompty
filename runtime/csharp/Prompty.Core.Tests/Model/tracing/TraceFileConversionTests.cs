using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class TraceFileConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
runtime: python
version: 2.0.0

""";

        var instance = TraceFile.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("python", instance.Runtime);
        Assert.Equal("2.0.0", instance.Version);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "runtime": "python",
  "version": "2.0.0"
}
""";

        var instance = TraceFile.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("python", instance.Runtime);
        Assert.Equal("2.0.0", instance.Version);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "runtime": "python",
  "version": "2.0.0"
}
""";

        var original = TraceFile.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = TraceFile.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("python", reloaded.Runtime);
        Assert.Equal("2.0.0", reloaded.Version);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
runtime: python
version: 2.0.0

""";

        var original = TraceFile.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = TraceFile.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("python", reloaded.Runtime);
        Assert.Equal("2.0.0", reloaded.Version);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "runtime": "python",
  "version": "2.0.0"
}
""";

        var instance = TraceFile.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
runtime: python
version: 2.0.0

""";

        var instance = TraceFile.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
