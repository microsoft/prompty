
using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ImagePartConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
source: "https://example.com/image.png"
detail: auto
mediaType: image/png

""";

        var instance = ImagePart.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("https://example.com/image.png", instance.Source);
        Assert.Equal("auto", instance.Detail);
        Assert.Equal("image/png", instance.MediaType);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "source": "https://example.com/image.png",
  "detail": "auto",
  "mediaType": "image/png"
}
""";

        var instance = ImagePart.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("https://example.com/image.png", instance.Source);
        Assert.Equal("auto", instance.Detail);
        Assert.Equal("image/png", instance.MediaType);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "source": "https://example.com/image.png",
  "detail": "auto",
  "mediaType": "image/png"
}
""";

        var original = ImagePart.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = ImagePart.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("https://example.com/image.png", reloaded.Source);
        Assert.Equal("auto", reloaded.Detail);
        Assert.Equal("image/png", reloaded.MediaType);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
source: "https://example.com/image.png"
detail: auto
mediaType: image/png

""";

        var original = ImagePart.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = ImagePart.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("https://example.com/image.png", reloaded.Source);
        Assert.Equal("auto", reloaded.Detail);
        Assert.Equal("image/png", reloaded.MediaType);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "source": "https://example.com/image.png",
  "detail": "auto",
  "mediaType": "image/png"
}
""";

        var instance = ImagePart.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
source: "https://example.com/image.png"
detail: auto
mediaType: image/png

""";

        var instance = ImagePart.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
