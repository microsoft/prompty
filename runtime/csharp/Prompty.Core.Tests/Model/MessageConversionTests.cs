
using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class MessageConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
role: user
parts:
  - kind: text
    value: Hello!
metadata:
  source: user-input

""";

        var instance = Message.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("user", instance.Role);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "role": "user",
  "parts": [
    {
      "kind": "text",
      "value": "Hello!"
    }
  ],
  "metadata": {
    "source": "user-input"
  }
}
""";

        var instance = Message.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("user", instance.Role);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "role": "user",
  "parts": [
    {
      "kind": "text",
      "value": "Hello!"
    }
  ],
  "metadata": {
    "source": "user-input"
  }
}
""";

        var original = Message.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = Message.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("user", reloaded.Role);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
role: user
parts:
  - kind: text
    value: Hello!
metadata:
  source: user-input

""";

        var original = Message.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = Message.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("user", reloaded.Role);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "role": "user",
  "parts": [
    {
      "kind": "text",
      "value": "Hello!"
    }
  ],
  "metadata": {
    "source": "user-input"
  }
}
""";

        var instance = Message.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
role: user
parts:
  - kind: text
    value: Hello!
metadata:
  source: user-input

""";

        var instance = Message.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void FactoryAssistant()
    {
        var instance = Message.Assistant("test");
        Assert.NotNull(instance);
        Assert.Equal("assistant", instance.Role);
    }

    [Fact]
    public void FactorySystem()
    {
        var instance = Message.System("test");
        Assert.NotNull(instance);
        Assert.Equal("system", instance.Role);
    }

    [Fact]
    public void FactoryUser()
    {
        var instance = Message.User("test");
        Assert.NotNull(instance);
        Assert.Equal("user", instance.Role);
    }

}
