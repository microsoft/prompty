
using Xunit;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130


public class FoundryConnectionConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
kind: foundry
endpoint: "https://myresource.services.ai.azure.com/api/projects/myproject"
name: my-openai-connection
connectionType: model

""";

        var instance = FoundryConnection.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("foundry", instance.Kind);
        Assert.Equal("https://myresource.services.ai.azure.com/api/projects/myproject", instance.Endpoint);
        Assert.Equal("my-openai-connection", instance.Name);
        Assert.Equal("model", instance.ConnectionType);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "kind": "foundry",
  "endpoint": "https://myresource.services.ai.azure.com/api/projects/myproject",
  "name": "my-openai-connection",
  "connectionType": "model"
}
""";

        var instance = FoundryConnection.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("foundry", instance.Kind);
        Assert.Equal("https://myresource.services.ai.azure.com/api/projects/myproject", instance.Endpoint);
        Assert.Equal("my-openai-connection", instance.Name);
        Assert.Equal("model", instance.ConnectionType);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "kind": "foundry",
  "endpoint": "https://myresource.services.ai.azure.com/api/projects/myproject",
  "name": "my-openai-connection",
  "connectionType": "model"
}
""";

        var original = FoundryConnection.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = FoundryConnection.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("foundry", reloaded.Kind);
        Assert.Equal("https://myresource.services.ai.azure.com/api/projects/myproject", reloaded.Endpoint);
        Assert.Equal("my-openai-connection", reloaded.Name);
        Assert.Equal("model", reloaded.ConnectionType);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
kind: foundry
endpoint: "https://myresource.services.ai.azure.com/api/projects/myproject"
name: my-openai-connection
connectionType: model

""";

        var original = FoundryConnection.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = FoundryConnection.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("foundry", reloaded.Kind);
        Assert.Equal("https://myresource.services.ai.azure.com/api/projects/myproject", reloaded.Endpoint);
        Assert.Equal("my-openai-connection", reloaded.Name);
        Assert.Equal("model", reloaded.ConnectionType);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "kind": "foundry",
  "endpoint": "https://myresource.services.ai.azure.com/api/projects/myproject",
  "name": "my-openai-connection",
  "connectionType": "model"
}
""";

        var instance = FoundryConnection.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
kind: foundry
endpoint: "https://myresource.services.ai.azure.com/api/projects/myproject"
name: my-openai-connection
connectionType: model

""";

        var instance = FoundryConnection.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
