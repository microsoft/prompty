using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class DoneEventPayloadConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
response: The weather in Paris is 72°F and sunny.

""";

        var instance = DoneEventPayload.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("The weather in Paris is 72°F and sunny.", instance.Response);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "response": "The weather in Paris is 72°F and sunny."
}
""";

        var instance = DoneEventPayload.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("The weather in Paris is 72°F and sunny.", instance.Response);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "response": "The weather in Paris is 72°F and sunny."
}
""";

        var original = DoneEventPayload.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = DoneEventPayload.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("The weather in Paris is 72°F and sunny.", reloaded.Response);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
response: The weather in Paris is 72°F and sunny.

""";

        var original = DoneEventPayload.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = DoneEventPayload.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("The weather in Paris is 72°F and sunny.", reloaded.Response);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "response": "The weather in Paris is 72°F and sunny."
}
""";

        var instance = DoneEventPayload.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
response: The weather in Paris is 72°F and sunny.

""";

        var instance = DoneEventPayload.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
