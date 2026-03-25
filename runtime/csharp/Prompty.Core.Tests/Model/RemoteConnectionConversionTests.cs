
using Xunit;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130


public class RemoteConnectionConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
kind: remote
name: my-reference-connection
endpoint: "https://{your-custom-endpoint}.openai.azure.com/"

""";

        var instance = RemoteConnection.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("remote", instance.Kind);
        Assert.Equal("my-reference-connection", instance.Name);
        Assert.Equal("https://{your-custom-endpoint}.openai.azure.com/", instance.Endpoint);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "kind": "remote",
  "name": "my-reference-connection",
  "endpoint": "https://{your-custom-endpoint}.openai.azure.com/"
}
""";

        var instance = RemoteConnection.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("remote", instance.Kind);
        Assert.Equal("my-reference-connection", instance.Name);
        Assert.Equal("https://{your-custom-endpoint}.openai.azure.com/", instance.Endpoint);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "kind": "remote",
  "name": "my-reference-connection",
  "endpoint": "https://{your-custom-endpoint}.openai.azure.com/"
}
""";

        var original = RemoteConnection.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = RemoteConnection.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("remote", reloaded.Kind);
        Assert.Equal("my-reference-connection", reloaded.Name);
        Assert.Equal("https://{your-custom-endpoint}.openai.azure.com/", reloaded.Endpoint);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
kind: remote
name: my-reference-connection
endpoint: "https://{your-custom-endpoint}.openai.azure.com/"

""";

        var original = RemoteConnection.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = RemoteConnection.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("remote", reloaded.Kind);
        Assert.Equal("my-reference-connection", reloaded.Name);
        Assert.Equal("https://{your-custom-endpoint}.openai.azure.com/", reloaded.Endpoint);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "kind": "remote",
  "name": "my-reference-connection",
  "endpoint": "https://{your-custom-endpoint}.openai.azure.com/"
}
""";

        var instance = RemoteConnection.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
kind: remote
name: my-reference-connection
endpoint: "https://{your-custom-endpoint}.openai.azure.com/"

""";

        var instance = RemoteConnection.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
