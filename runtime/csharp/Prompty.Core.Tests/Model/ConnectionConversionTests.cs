
using Xunit;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130


public class ConnectionConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
kind: reference
authenticationMode: system
usageDescription: This will allow the agent to respond to an email on your behalf

""";

        var instance = Connection.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("reference", instance.Kind);
        Assert.Equal("system", instance.AuthenticationMode);
        Assert.Equal("This will allow the agent to respond to an email on your behalf", instance.UsageDescription);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "kind": "reference",
  "authenticationMode": "system",
  "usageDescription": "This will allow the agent to respond to an email on your behalf"
}
""";

        var instance = Connection.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("reference", instance.Kind);
        Assert.Equal("system", instance.AuthenticationMode);
        Assert.Equal("This will allow the agent to respond to an email on your behalf", instance.UsageDescription);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "kind": "reference",
  "authenticationMode": "system",
  "usageDescription": "This will allow the agent to respond to an email on your behalf"
}
""";

        var original = Connection.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = Connection.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("reference", reloaded.Kind);
        Assert.Equal("system", reloaded.AuthenticationMode);
        Assert.Equal("This will allow the agent to respond to an email on your behalf", reloaded.UsageDescription);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
kind: reference
authenticationMode: system
usageDescription: This will allow the agent to respond to an email on your behalf

""";

        var original = Connection.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = Connection.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("reference", reloaded.Kind);
        Assert.Equal("system", reloaded.AuthenticationMode);
        Assert.Equal("This will allow the agent to respond to an email on your behalf", reloaded.UsageDescription);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "kind": "reference",
  "authenticationMode": "system",
  "usageDescription": "This will allow the agent to respond to an email on your behalf"
}
""";

        var instance = Connection.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
kind: reference
authenticationMode: system
usageDescription: This will allow the agent to respond to an email on your behalf

""";

        var instance = Connection.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
