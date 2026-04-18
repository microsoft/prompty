using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class FileNotFoundErrorConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
message: "Prompty file not found: ./chat.prompty"
path: ./chat.prompty

""";

        var instance = FileNotFoundError.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("Prompty file not found: ./chat.prompty", instance.Message);
        Assert.Equal("./chat.prompty", instance.Path);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "message": "Prompty file not found: ./chat.prompty",
  "path": "./chat.prompty"
}
""";

        var instance = FileNotFoundError.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("Prompty file not found: ./chat.prompty", instance.Message);
        Assert.Equal("./chat.prompty", instance.Path);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "message": "Prompty file not found: ./chat.prompty",
  "path": "./chat.prompty"
}
""";

        var original = FileNotFoundError.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = FileNotFoundError.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("Prompty file not found: ./chat.prompty", reloaded.Message);
        Assert.Equal("./chat.prompty", reloaded.Path);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
message: "Prompty file not found: ./chat.prompty"
path: ./chat.prompty

""";

        var original = FileNotFoundError.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = FileNotFoundError.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("Prompty file not found: ./chat.prompty", reloaded.Message);
        Assert.Equal("./chat.prompty", reloaded.Path);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "message": "Prompty file not found: ./chat.prompty",
  "path": "./chat.prompty"
}
""";

        var instance = FileNotFoundError.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
message: "Prompty file not found: ./chat.prompty"
path: ./chat.prompty

""";

        var instance = FileNotFoundError.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
