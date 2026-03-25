
using Xunit;

#pragma warning disable IDE0130
namespace AgentSchema;
#pragma warning restore IDE0130


public class PropertySchemaConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
examples:
  - key: value
strict: true
properties:
  firstName:
    kind: string
    sample: Jane
  lastName:
    kind: string
    sample: Doe
  question:
    kind: string
    sample: What is the meaning of life?

""";

        var instance = PropertySchema.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.True(instance.Strict);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "examples": [
    {
      "key": "value"
    }
  ],
  "strict": true,
  "properties": {
    "firstName": {
      "kind": "string",
      "sample": "Jane"
    },
    "lastName": {
      "kind": "string",
      "sample": "Doe"
    },
    "question": {
      "kind": "string",
      "sample": "What is the meaning of life?"
    }
  }
}
""";

        var instance = PropertySchema.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.True(instance.Strict);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "examples": [
    {
      "key": "value"
    }
  ],
  "strict": true,
  "properties": {
    "firstName": {
      "kind": "string",
      "sample": "Jane"
    },
    "lastName": {
      "kind": "string",
      "sample": "Doe"
    },
    "question": {
      "kind": "string",
      "sample": "What is the meaning of life?"
    }
  }
}
""";

        var original = PropertySchema.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = PropertySchema.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.True(reloaded.Strict);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
examples:
  - key: value
strict: true
properties:
  firstName:
    kind: string
    sample: Jane
  lastName:
    kind: string
    sample: Doe
  question:
    kind: string
    sample: What is the meaning of life?

""";

        var original = PropertySchema.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = PropertySchema.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.True(reloaded.Strict);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "examples": [
    {
      "key": "value"
    }
  ],
  "strict": true,
  "properties": {
    "firstName": {
      "kind": "string",
      "sample": "Jane"
    },
    "lastName": {
      "kind": "string",
      "sample": "Doe"
    },
    "question": {
      "kind": "string",
      "sample": "What is the meaning of life?"
    }
  }
}
""";

        var instance = PropertySchema.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
examples:
  - key: value
strict: true
properties:
  firstName:
    kind: string
    sample: Jane
  lastName:
    kind: string
    sample: Doe
  question:
    kind: string
    sample: What is the meaning of life?

""";

        var instance = PropertySchema.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
