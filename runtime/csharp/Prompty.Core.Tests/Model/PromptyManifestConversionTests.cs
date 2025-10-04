using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class PromptyManifestConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: manifest
        template:
          format: mustache
          parser: prompty
        instructions: |-
          system:
          You are an AI assistant who helps people find information.
          As the assistant, you answer questions briefly, succinctly,
          and in a personable manner using markdown and even add some 
          personal flair with appropriate emojis.
        
          # Customer
          You are helping {{firstName}} {{lastName}} to find answers to 
          their questions. Use their name to address them in your responses.
          user:
          {{question}}
        models:
          - id: gpt-35-turbo
          - id: gpt-4o
          - custom-model-id
        parameters:
          param1:
            kind: string
          param2:
            kind: number
        
        """;

        var instance = YamlSerializer.Deserialize<PromptyManifest>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("manifest", instance.Kind);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}", instance.Instructions);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "manifest",
          "template": {
            "format": "mustache",
            "parser": "prompty"
          },
          "instructions": "system:\nYou are an AI assistant who helps people find information.\nAs the assistant, you answer questions briefly, succinctly,\nand in a personable manner using markdown and even add some \npersonal flair with appropriate emojis.\n\n# Customer\nYou are helping {{firstName}} {{lastName}} to find answers to \ntheir questions. Use their name to address them in your responses.\nuser:\n{{question}}",
          "models": [
            {
              "id": "gpt-35-turbo"
            },
            {
              "id": "gpt-4o"
            },
            "custom-model-id"
          ],
          "parameters": {
            "param1": {
              "kind": "string"
            },
            "param2": {
              "kind": "number"
            }
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<PromptyManifest>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("manifest", instance.Kind);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}", instance.Instructions);
    }
}