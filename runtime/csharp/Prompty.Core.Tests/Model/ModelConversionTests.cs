
using Xunit;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130


public class ModelConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
id: gpt-35-turbo
provider: azure
apiType: chat
connection:
  kind: key
  endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
  key: "{your-api-key}"
options:
  type: chat
  temperature: 0.7
  maxTokens: 1000

""";

        var instance = Model.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("gpt-35-turbo", instance.Id);
        Assert.Equal("azure", instance.Provider);
        Assert.Equal("chat", instance.ApiType);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "id": "gpt-35-turbo",
  "provider": "azure",
  "apiType": "chat",
  "connection": {
    "kind": "key",
    "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
    "key": "{your-api-key}"
  },
  "options": {
    "type": "chat",
    "temperature": 0.7,
    "maxTokens": 1000
  }
}
""";

        var instance = Model.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("gpt-35-turbo", instance.Id);
        Assert.Equal("azure", instance.Provider);
        Assert.Equal("chat", instance.ApiType);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "id": "gpt-35-turbo",
  "provider": "azure",
  "apiType": "chat",
  "connection": {
    "kind": "key",
    "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
    "key": "{your-api-key}"
  },
  "options": {
    "type": "chat",
    "temperature": 0.7,
    "maxTokens": 1000
  }
}
""";

        var original = Model.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = Model.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("gpt-35-turbo", reloaded.Id);
        Assert.Equal("azure", reloaded.Provider);
        Assert.Equal("chat", reloaded.ApiType);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
id: gpt-35-turbo
provider: azure
apiType: chat
connection:
  kind: key
  endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
  key: "{your-api-key}"
options:
  type: chat
  temperature: 0.7
  maxTokens: 1000

""";

        var original = Model.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = Model.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("gpt-35-turbo", reloaded.Id);
        Assert.Equal("azure", reloaded.Provider);
        Assert.Equal("chat", reloaded.ApiType);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "id": "gpt-35-turbo",
  "provider": "azure",
  "apiType": "chat",
  "connection": {
    "kind": "key",
    "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
    "key": "{your-api-key}"
  },
  "options": {
    "type": "chat",
    "temperature": 0.7,
    "maxTokens": 1000
  }
}
""";

        var instance = Model.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
id: gpt-35-turbo
provider: azure
apiType: chat
connection:
  kind: key
  endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
  key: "{your-api-key}"
options:
  type: chat
  temperature: 0.7
  maxTokens: 1000

""";

        var instance = Model.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
    [Fact]
    public void LoadJsonFromString()
    {
        // alternate representation as string
        var data = "\"example\"";
        var instance = Model.FromJson(data);
        Assert.NotNull(instance);
        Assert.Equal("example", instance.Id);
    }


    [Fact]
    public void LoadYamlFromString()
    {
        // alternate representation as string
        var data = "\"example\"";
        var instance = Model.FromYaml(data);
        Assert.NotNull(instance);
        Assert.Equal("example", instance.Id);
    }
    
}
