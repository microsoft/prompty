using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class AnthropicToolUseBlockConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
id: toolu_01A09q90qw90lq917835lq9
name: get_weather
input:
  city: Paris

""";

        var instance = AnthropicToolUseBlock.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("toolu_01A09q90qw90lq917835lq9", instance.Id);
        Assert.Equal("get_weather", instance.Name);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "id": "toolu_01A09q90qw90lq917835lq9",
  "name": "get_weather",
  "input": {
    "city": "Paris"
  }
}
""";

        var instance = AnthropicToolUseBlock.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("toolu_01A09q90qw90lq917835lq9", instance.Id);
        Assert.Equal("get_weather", instance.Name);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "id": "toolu_01A09q90qw90lq917835lq9",
  "name": "get_weather",
  "input": {
    "city": "Paris"
  }
}
""";

        var original = AnthropicToolUseBlock.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = AnthropicToolUseBlock.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("toolu_01A09q90qw90lq917835lq9", reloaded.Id);
        Assert.Equal("get_weather", reloaded.Name);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
id: toolu_01A09q90qw90lq917835lq9
name: get_weather
input:
  city: Paris

""";

        var original = AnthropicToolUseBlock.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = AnthropicToolUseBlock.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("toolu_01A09q90qw90lq917835lq9", reloaded.Id);
        Assert.Equal("get_weather", reloaded.Name);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "id": "toolu_01A09q90qw90lq917835lq9",
  "name": "get_weather",
  "input": {
    "city": "Paris"
  }
}
""";

        var instance = AnthropicToolUseBlock.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
id: toolu_01A09q90qw90lq917835lq9
name: get_weather
input:
  city: Paris

""";

        var instance = AnthropicToolUseBlock.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
