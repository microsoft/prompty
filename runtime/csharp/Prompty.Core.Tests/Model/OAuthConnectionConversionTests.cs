using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class OAuthConnectionConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: oauth
        endpoint: https://{your-custom-endpoint}.openai.azure.com/
        clientId: your-client-id
        clientSecret: your-client-secret
        tokenUrl: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
        scopes:
          - https://cognitiveservices.azure.com/.default
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "oauth",
          "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
          "clientId": "your-client-id",
          "clientSecret": "your-client-secret",
          "tokenUrl": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
          "scopes": [
            "https://cognitiveservices.azure.com/.default"
          ]
        }
        """;

        var instance = JsonSerializer.Deserialize<OAuthConnection>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("oauth", instance.Kind);
        Assert.Equal("https://{your-custom-endpoint}.openai.azure.com/", instance.Endpoint);
        Assert.Equal("your-client-id", instance.ClientId);
        Assert.Equal("your-client-secret", instance.ClientSecret);
        Assert.Equal("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token", instance.TokenUrl);
    }
}