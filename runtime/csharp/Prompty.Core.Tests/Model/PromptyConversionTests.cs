using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class PromptyConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: prompt
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
        
        """;

        var instance = YamlSerializer.Deserialize<Prompty>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("prompt", instance.Kind);
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
          "kind": "prompt",
          "template": {
            "format": "mustache",
            "parser": "prompty"
          },
          "instructions": "system:\nYou are an AI assistant who helps people find information.\nAs the assistant, you answer questions briefly, succinctly,\nand in a personable manner using markdown and even add some \npersonal flair with appropriate emojis.\n\n# Customer\nYou are helping {{firstName}} {{lastName}} to find answers to \ntheir questions. Use their name to address them in your responses.\nuser:\n{{question}}"
        }
        """;

        var instance = JsonSerializer.Deserialize<Prompty>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("prompt", instance.Kind);
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