using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class AnthropicMessagesResponseConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
id: msg_01XFDUDYJgAACzvnptvVoYEL
model: claude-sonnet-4-20250514
stop_reason: end_turn

""";

        var instance = AnthropicMessagesResponse.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("msg_01XFDUDYJgAACzvnptvVoYEL", instance.Id);
        Assert.Equal("claude-sonnet-4-20250514", instance.Model);
        Assert.Equal("end_turn", instance.StopReason);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "model": "claude-sonnet-4-20250514",
  "stop_reason": "end_turn"
}
""";

        var instance = AnthropicMessagesResponse.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("msg_01XFDUDYJgAACzvnptvVoYEL", instance.Id);
        Assert.Equal("claude-sonnet-4-20250514", instance.Model);
        Assert.Equal("end_turn", instance.StopReason);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "model": "claude-sonnet-4-20250514",
  "stop_reason": "end_turn"
}
""";

        var original = AnthropicMessagesResponse.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = AnthropicMessagesResponse.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("msg_01XFDUDYJgAACzvnptvVoYEL", reloaded.Id);
        Assert.Equal("claude-sonnet-4-20250514", reloaded.Model);
        Assert.Equal("end_turn", reloaded.StopReason);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
id: msg_01XFDUDYJgAACzvnptvVoYEL
model: claude-sonnet-4-20250514
stop_reason: end_turn

""";

        var original = AnthropicMessagesResponse.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = AnthropicMessagesResponse.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("msg_01XFDUDYJgAACzvnptvVoYEL", reloaded.Id);
        Assert.Equal("claude-sonnet-4-20250514", reloaded.Model);
        Assert.Equal("end_turn", reloaded.StopReason);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "model": "claude-sonnet-4-20250514",
  "stop_reason": "end_turn"
}
""";

        var instance = AnthropicMessagesResponse.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
id: msg_01XFDUDYJgAACzvnptvVoYEL
model: claude-sonnet-4-20250514
stop_reason: end_turn

""";

        var instance = AnthropicMessagesResponse.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
