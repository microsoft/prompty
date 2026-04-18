using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class AnthropicMessagesRequestConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
model: claude-sonnet-4-20250514
max_tokens: 4096
system: You are a helpful assistant.
temperature: 0.7
top_p: 0.9
top_k: 40
stop_sequences:
  - "\n\nHuman:"

""";

        var instance = AnthropicMessagesRequest.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("claude-sonnet-4-20250514", instance.Model);
        Assert.Equal(4096, instance.MaxTokens);
        Assert.Equal("You are a helpful assistant.", instance.System);
        Assert.Equal(0.7f, instance.Temperature);
        Assert.Equal(0.9f, instance.TopP);
        Assert.Equal(40, instance.TopK);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 4096,
  "system": "You are a helpful assistant.",
  "temperature": 0.7,
  "top_p": 0.9,
  "top_k": 40,
  "stop_sequences": [
    "\n\nHuman:"
  ]
}
""";

        var instance = AnthropicMessagesRequest.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("claude-sonnet-4-20250514", instance.Model);
        Assert.Equal(4096, instance.MaxTokens);
        Assert.Equal("You are a helpful assistant.", instance.System);
        Assert.Equal(0.7f, instance.Temperature);
        Assert.Equal(0.9f, instance.TopP);
        Assert.Equal(40, instance.TopK);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 4096,
  "system": "You are a helpful assistant.",
  "temperature": 0.7,
  "top_p": 0.9,
  "top_k": 40,
  "stop_sequences": [
    "\n\nHuman:"
  ]
}
""";

        var original = AnthropicMessagesRequest.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = AnthropicMessagesRequest.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("claude-sonnet-4-20250514", reloaded.Model);
        Assert.Equal(4096, reloaded.MaxTokens);
        Assert.Equal("You are a helpful assistant.", reloaded.System);
        Assert.Equal(0.7f, reloaded.Temperature);
        Assert.Equal(0.9f, reloaded.TopP);
        Assert.Equal(40, reloaded.TopK);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
model: claude-sonnet-4-20250514
max_tokens: 4096
system: You are a helpful assistant.
temperature: 0.7
top_p: 0.9
top_k: 40
stop_sequences:
  - "\n\nHuman:"

""";

        var original = AnthropicMessagesRequest.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = AnthropicMessagesRequest.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("claude-sonnet-4-20250514", reloaded.Model);
        Assert.Equal(4096, reloaded.MaxTokens);
        Assert.Equal("You are a helpful assistant.", reloaded.System);
        Assert.Equal(0.7f, reloaded.Temperature);
        Assert.Equal(0.9f, reloaded.TopP);
        Assert.Equal(40, reloaded.TopK);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 4096,
  "system": "You are a helpful assistant.",
  "temperature": 0.7,
  "top_p": 0.9,
  "top_k": 40,
  "stop_sequences": [
    "\n\nHuman:"
  ]
}
""";

        var instance = AnthropicMessagesRequest.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
model: claude-sonnet-4-20250514
max_tokens: 4096
system: You are a helpful assistant.
temperature: 0.7
top_p: 0.9
top_k: 40
stop_sequences:
  - "\n\nHuman:"

""";

        var instance = AnthropicMessagesRequest.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
