
using Xunit;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130


public class OAuthConnectionConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
kind: oauth
endpoint: "https://api.example.com"
clientId: your-client-id
clientSecret: your-client-secret
tokenUrl: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
scopes:
  - "https://cognitiveservices.azure.com/.default"

""";

        var instance = OAuthConnection.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("oauth", instance.Kind);
        Assert.Equal("https://api.example.com", instance.Endpoint);
        Assert.Equal("your-client-id", instance.ClientId);
        Assert.Equal("your-client-secret", instance.ClientSecret);
        Assert.Equal("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token", instance.TokenUrl);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "kind": "oauth",
  "endpoint": "https://api.example.com",
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "tokenUrl": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
  "scopes": [
    "https://cognitiveservices.azure.com/.default"
  ]
}
""";

        var instance = OAuthConnection.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("oauth", instance.Kind);
        Assert.Equal("https://api.example.com", instance.Endpoint);
        Assert.Equal("your-client-id", instance.ClientId);
        Assert.Equal("your-client-secret", instance.ClientSecret);
        Assert.Equal("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token", instance.TokenUrl);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "kind": "oauth",
  "endpoint": "https://api.example.com",
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "tokenUrl": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
  "scopes": [
    "https://cognitiveservices.azure.com/.default"
  ]
}
""";

        var original = OAuthConnection.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = OAuthConnection.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("oauth", reloaded.Kind);
        Assert.Equal("https://api.example.com", reloaded.Endpoint);
        Assert.Equal("your-client-id", reloaded.ClientId);
        Assert.Equal("your-client-secret", reloaded.ClientSecret);
        Assert.Equal("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token", reloaded.TokenUrl);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
kind: oauth
endpoint: "https://api.example.com"
clientId: your-client-id
clientSecret: your-client-secret
tokenUrl: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
scopes:
  - "https://cognitiveservices.azure.com/.default"

""";

        var original = OAuthConnection.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = OAuthConnection.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("oauth", reloaded.Kind);
        Assert.Equal("https://api.example.com", reloaded.Endpoint);
        Assert.Equal("your-client-id", reloaded.ClientId);
        Assert.Equal("your-client-secret", reloaded.ClientSecret);
        Assert.Equal("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token", reloaded.TokenUrl);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "kind": "oauth",
  "endpoint": "https://api.example.com",
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "tokenUrl": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
  "scopes": [
    "https://cognitiveservices.azure.com/.default"
  ]
}
""";

        var instance = OAuthConnection.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
kind: oauth
endpoint: "https://api.example.com"
clientId: your-client-id
clientSecret: your-client-secret
tokenUrl: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
scopes:
  - "https://cognitiveservices.azure.com/.default"

""";

        var instance = OAuthConnection.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
