
using Xunit;

#pragma warning disable IDE0130
namespace Prompty;
#pragma warning restore IDE0130


public class FunctionToolConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
kind: function
parameters:
  firstName:
    kind: string
    default: Jane
  lastName:
    kind: string
    default: Doe
  question:
    kind: string
    default: What is the meaning of life?
strict: true

""";

        var instance = FunctionTool.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("function", instance.Kind);
        Assert.True(instance.Strict);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "kind": "function",
  "parameters": {
    "firstName": {
      "kind": "string",
      "default": "Jane"
    },
    "lastName": {
      "kind": "string",
      "default": "Doe"
    },
    "question": {
      "kind": "string",
      "default": "What is the meaning of life?"
    }
  },
  "strict": true
}
""";

        var instance = FunctionTool.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("function", instance.Kind);
        Assert.True(instance.Strict);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "kind": "function",
  "parameters": {
    "firstName": {
      "kind": "string",
      "default": "Jane"
    },
    "lastName": {
      "kind": "string",
      "default": "Doe"
    },
    "question": {
      "kind": "string",
      "default": "What is the meaning of life?"
    }
  },
  "strict": true
}
""";

        var original = FunctionTool.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = FunctionTool.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("function", reloaded.Kind);
        Assert.True(reloaded.Strict);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
kind: function
parameters:
  firstName:
    kind: string
    default: Jane
  lastName:
    kind: string
    default: Doe
  question:
    kind: string
    default: What is the meaning of life?
strict: true

""";

        var original = FunctionTool.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = FunctionTool.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("function", reloaded.Kind);
        Assert.True(reloaded.Strict);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "kind": "function",
  "parameters": {
    "firstName": {
      "kind": "string",
      "default": "Jane"
    },
    "lastName": {
      "kind": "string",
      "default": "Doe"
    },
    "question": {
      "kind": "string",
      "default": "What is the meaning of life?"
    }
  },
  "strict": true
}
""";

        var instance = FunctionTool.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
kind: function
parameters:
  firstName:
    kind: string
    default: Jane
  lastName:
    kind: string
    default: Doe
  question:
    kind: string
    default: What is the meaning of life?
strict: true

""";

        var instance = FunctionTool.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
    [Fact]
    public void LoadYamlInput1()
    {
        string yamlData = """
kind: function
parameters:
  - name: firstName
    kind: string
    default: Jane
  - name: lastName
    kind: string
    default: Doe
  - name: question
    kind: string
    default: What is the meaning of life?
strict: true

""";

        var instance = FunctionTool.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("function", instance.Kind);
        Assert.True(instance.Strict);
    }

    [Fact]
    public void LoadJsonInput1()
    {
        string jsonData = """
{
  "kind": "function",
  "parameters": [
    {
      "name": "firstName",
      "kind": "string",
      "default": "Jane"
    },
    {
      "name": "lastName",
      "kind": "string",
      "default": "Doe"
    },
    {
      "name": "question",
      "kind": "string",
      "default": "What is the meaning of life?"
    }
  ],
  "strict": true
}
""";

        var instance = FunctionTool.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("function", instance.Kind);
        Assert.True(instance.Strict);
    }

    [Fact]
    public void RoundtripJson1()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "kind": "function",
  "parameters": [
    {
      "name": "firstName",
      "kind": "string",
      "default": "Jane"
    },
    {
      "name": "lastName",
      "kind": "string",
      "default": "Doe"
    },
    {
      "name": "question",
      "kind": "string",
      "default": "What is the meaning of life?"
    }
  ],
  "strict": true
}
""";

        var original = FunctionTool.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = FunctionTool.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("function", reloaded.Kind);
        Assert.True(reloaded.Strict);
    }

    [Fact]
    public void RoundtripYaml1()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
kind: function
parameters:
  - name: firstName
    kind: string
    default: Jane
  - name: lastName
    kind: string
    default: Doe
  - name: question
    kind: string
    default: What is the meaning of life?
strict: true

""";

        var original = FunctionTool.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = FunctionTool.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("function", reloaded.Kind);
        Assert.True(reloaded.Strict);
    }

    [Fact]
    public void ToJsonProducesValidJson1()
    {
        string jsonData = """
{
  "kind": "function",
  "parameters": [
    {
      "name": "firstName",
      "kind": "string",
      "default": "Jane"
    },
    {
      "name": "lastName",
      "kind": "string",
      "default": "Doe"
    },
    {
      "name": "question",
      "kind": "string",
      "default": "What is the meaning of life?"
    }
  ],
  "strict": true
}
""";

        var instance = FunctionTool.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml1()
    {
        string yamlData = """
kind: function
parameters:
  - name: firstName
    kind: string
    default: Jane
  - name: lastName
    kind: string
    default: Doe
  - name: question
    kind: string
    default: What is the meaning of life?
strict: true

""";

        var instance = FunctionTool.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
