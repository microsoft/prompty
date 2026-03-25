
using Xunit;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130


public class ApiKeyConnectionConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
kind: key
endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
apiKey: your-api-key

""";

        var instance = ApiKeyConnection.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("key", instance.Kind);
        Assert.Equal("https://{your-custom-endpoint}.openai.azure.com/", instance.Endpoint);
        Assert.Equal("your-api-key", instance.ApiKey);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "kind": "key",
  "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
  "apiKey": "your-api-key"
}
""";

        var instance = ApiKeyConnection.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("key", instance.Kind);
        Assert.Equal("https://{your-custom-endpoint}.openai.azure.com/", instance.Endpoint);
        Assert.Equal("your-api-key", instance.ApiKey);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "kind": "key",
  "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
  "apiKey": "your-api-key"
}
""";

        var original = ApiKeyConnection.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = ApiKeyConnection.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("key", reloaded.Kind);
        Assert.Equal("https://{your-custom-endpoint}.openai.azure.com/", reloaded.Endpoint);
        Assert.Equal("your-api-key", reloaded.ApiKey);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
kind: key
endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
apiKey: your-api-key

""";

        var original = ApiKeyConnection.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = ApiKeyConnection.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("key", reloaded.Kind);
        Assert.Equal("https://{your-custom-endpoint}.openai.azure.com/", reloaded.Endpoint);
        Assert.Equal("your-api-key", reloaded.ApiKey);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "kind": "key",
  "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
  "apiKey": "your-api-key"
}
""";

        var instance = ApiKeyConnection.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
kind: key
endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
apiKey: your-api-key

""";

        var instance = ApiKeyConnection.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
