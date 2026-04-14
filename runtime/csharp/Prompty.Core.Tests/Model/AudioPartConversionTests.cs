
using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class AudioPartConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
source: "https://example.com/audio.wav"
mediaType: audio/wav

""";

        var instance = AudioPart.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("https://example.com/audio.wav", instance.Source);
        Assert.Equal("audio/wav", instance.MediaType);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "source": "https://example.com/audio.wav",
  "mediaType": "audio/wav"
}
""";

        var instance = AudioPart.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("https://example.com/audio.wav", instance.Source);
        Assert.Equal("audio/wav", instance.MediaType);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "source": "https://example.com/audio.wav",
  "mediaType": "audio/wav"
}
""";

        var original = AudioPart.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = AudioPart.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("https://example.com/audio.wav", reloaded.Source);
        Assert.Equal("audio/wav", reloaded.MediaType);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
source: "https://example.com/audio.wav"
mediaType: audio/wav

""";

        var original = AudioPart.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = AudioPart.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("https://example.com/audio.wav", reloaded.Source);
        Assert.Equal("audio/wav", reloaded.MediaType);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "source": "https://example.com/audio.wav",
  "mediaType": "audio/wav"
}
""";

        var instance = AudioPart.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
source: "https://example.com/audio.wav"
mediaType: audio/wav

""";

        var instance = AudioPart.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
