using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
#pragma warning restore IDE0130


public class PromptyConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        id: unique-agent-id
        version: 1.0.0
        name: basic-prompt
        description: A basic prompt that uses the GPT-3 chat API to answer questions
        metadata:
          authors:
            - sethjuarez
            - jietong
          tags:
            - example
            - prompt
        model:
          id: gpt-35-turbo
          connection:
            kind: key
            endpoint: https://{your-custom-endpoint}.openai.azure.com/
            key: "{your-api-key}"
        inputs:
          firstName:
            kind: string
            sample: Jane
          lastName:
            kind: string
            sample: Doe
          question:
            kind: string
            sample: What is the meaning of life?
        outputs:
          answer:
            kind: string
            description: The answer to the user's question.
        tools:
          - name: getCurrentWeather
            kind: function
            description: Get the current weather in a given location
            parameters:
              location:
                kind: string
                description: The city and state, e.g. San Francisco, CA
              unit:
                kind: string
                description: The unit of temperature, e.g. Celsius or Fahrenheit
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
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "id": "unique-agent-id",
          "version": "1.0.0",
          "name": "basic-prompt",
          "description": "A basic prompt that uses the GPT-3 chat API to answer questions",
          "metadata": {
            "authors": [
              "sethjuarez",
              "jietong"
            ],
            "tags": [
              "example",
              "prompt"
            ]
          },
          "model": {
            "id": "gpt-35-turbo",
            "connection": {
              "kind": "key",
              "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
              "key": "{your-api-key}"
            }
          },
          "inputs": {
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
          },
          "outputs": {
            "answer": {
              "kind": "string",
              "description": "The answer to the user's question."
            }
          },
          "tools": [
            {
              "name": "getCurrentWeather",
              "kind": "function",
              "description": "Get the current weather in a given location",
              "parameters": {
                "location": {
                  "kind": "string",
                  "description": "The city and state, e.g. San Francisco, CA"
                },
                "unit": {
                  "kind": "string",
                  "description": "The unit of temperature, e.g. Celsius or Fahrenheit"
                }
              }
            }
          ],
          "template": {
            "format": "mustache",
            "parser": "prompty"
          },
          "instructions": "system:\nYou are an AI assistant who helps people find information.\nAs the assistant, you answer questions briefly, succinctly,\nand in a personable manner using markdown and even add some \npersonal flair with appropriate emojis.\n\n# Customer\nYou are helping {{firstName}} {{lastName}} to find answers to \ntheir questions. Use their name to address them in your responses.\nuser:\n{{question}}"
        }
        """;

        var instance = JsonSerializer.Deserialize<Prompty>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.id, "unique-agent-id");
        Assert.Equal(instance.version, "1.0.0");
        Assert.Equal(instance.name, "basic-prompt");
        Assert.Equal(instance.description, "A basic prompt that uses the GPT-3 chat API to answer questions");
        Assert.Equal(instance.instructions, """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some
personal flair with appropriate emojis.

# Customer
You are helping { { firstName} }
        { { lastName} }
        to find answers to
their questions. Use their name to address them in your responses.
user:
        { { question} }
        """);
    }
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        id: unique-agent-id
        version: 1.0.0
        name: basic-prompt
        description: A basic prompt that uses the GPT-3 chat API to answer questions
        metadata:
          authors:
            - sethjuarez
            - jietong
          tags:
            - example
            - prompt
        model:
          id: gpt-35-turbo
          connection:
            kind: key
            endpoint: https://{your-custom-endpoint}.openai.azure.com/
            key: "{your-api-key}"
        inputs:
          firstName:
            kind: string
            sample: Jane
          lastName:
            kind: string
            sample: Doe
          question:
            kind: string
            sample: What is the meaning of life?
        outputs:
          answer:
            kind: string
            description: The answer to the user's question.
        tools:
          getCurrentWeather:
            kind: function
            description: Get the current weather in a given location
            parameters:
              location:
                kind: string
                description: The city and state, e.g. San Francisco, CA
              unit:
                kind: string
                description: The unit of temperature, e.g. Celsius or Fahrenheit
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
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "id": "unique-agent-id",
          "version": "1.0.0",
          "name": "basic-prompt",
          "description": "A basic prompt that uses the GPT-3 chat API to answer questions",
          "metadata": {
            "authors": [
              "sethjuarez",
              "jietong"
            ],
            "tags": [
              "example",
              "prompt"
            ]
          },
          "model": {
            "id": "gpt-35-turbo",
            "connection": {
              "kind": "key",
              "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
              "key": "{your-api-key}"
            }
          },
          "inputs": {
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
          },
          "outputs": {
            "answer": {
              "kind": "string",
              "description": "The answer to the user's question."
            }
          },
          "tools": {
            "getCurrentWeather": {
              "kind": "function",
              "description": "Get the current weather in a given location",
              "parameters": {
                "location": {
                  "kind": "string",
                  "description": "The city and state, e.g. San Francisco, CA"
                },
                "unit": {
                  "kind": "string",
                  "description": "The unit of temperature, e.g. Celsius or Fahrenheit"
                }
              }
            }
          },
          "template": {
            "format": "mustache",
            "parser": "prompty"
          },
          "instructions": "system:\nYou are an AI assistant who helps people find information.\nAs the assistant, you answer questions briefly, succinctly,\nand in a personable manner using markdown and even add some \npersonal flair with appropriate emojis.\n\n# Customer\nYou are helping {{firstName}} {{lastName}} to find answers to \ntheir questions. Use their name to address them in your responses.\nuser:\n{{question}}"
        }
        """;

        var instance = JsonSerializer.Deserialize<Prompty>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.id, "unique-agent-id");
        Assert.Equal(instance.version, "1.0.0");
        Assert.Equal(instance.name, "basic-prompt");
        Assert.Equal(instance.description, "A basic prompt that uses the GPT-3 chat API to answer questions");
        Assert.Equal(instance.instructions, """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some
personal flair with appropriate emojis.

# Customer
You are helping { { firstName} }
        { { lastName} }
        to find answers to
their questions. Use their name to address them in your responses.
user:
        { { question} }
        """);
    }
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        id: unique-agent-id
        version: 1.0.0
        name: basic-prompt
        description: A basic prompt that uses the GPT-3 chat API to answer questions
        metadata:
          authors:
            - sethjuarez
            - jietong
          tags:
            - example
            - prompt
        model:
          id: gpt-35-turbo
          connection:
            kind: key
            endpoint: https://{your-custom-endpoint}.openai.azure.com/
            key: "{your-api-key}"
        inputs:
          firstName:
            kind: string
            sample: Jane
          lastName:
            kind: string
            sample: Doe
          question:
            kind: string
            sample: What is the meaning of life?
        outputs:
          - name: answer
            kind: string
            description: The answer to the user's question.
        tools:
          - name: getCurrentWeather
            kind: function
            description: Get the current weather in a given location
            parameters:
              location:
                kind: string
                description: The city and state, e.g. San Francisco, CA
              unit:
                kind: string
                description: The unit of temperature, e.g. Celsius or Fahrenheit
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
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "id": "unique-agent-id",
          "version": "1.0.0",
          "name": "basic-prompt",
          "description": "A basic prompt that uses the GPT-3 chat API to answer questions",
          "metadata": {
            "authors": [
              "sethjuarez",
              "jietong"
            ],
            "tags": [
              "example",
              "prompt"
            ]
          },
          "model": {
            "id": "gpt-35-turbo",
            "connection": {
              "kind": "key",
              "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
              "key": "{your-api-key}"
            }
          },
          "inputs": {
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
          },
          "outputs": [
            {
              "name": "answer",
              "kind": "string",
              "description": "The answer to the user's question."
            }
          ],
          "tools": [
            {
              "name": "getCurrentWeather",
              "kind": "function",
              "description": "Get the current weather in a given location",
              "parameters": {
                "location": {
                  "kind": "string",
                  "description": "The city and state, e.g. San Francisco, CA"
                },
                "unit": {
                  "kind": "string",
                  "description": "The unit of temperature, e.g. Celsius or Fahrenheit"
                }
              }
            }
          ],
          "template": {
            "format": "mustache",
            "parser": "prompty"
          },
          "instructions": "system:\nYou are an AI assistant who helps people find information.\nAs the assistant, you answer questions briefly, succinctly,\nand in a personable manner using markdown and even add some \npersonal flair with appropriate emojis.\n\n# Customer\nYou are helping {{firstName}} {{lastName}} to find answers to \ntheir questions. Use their name to address them in your responses.\nuser:\n{{question}}"
        }
        """;

        var instance = JsonSerializer.Deserialize<Prompty>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.id, "unique-agent-id");
        Assert.Equal(instance.version, "1.0.0");
        Assert.Equal(instance.name, "basic-prompt");
        Assert.Equal(instance.description, "A basic prompt that uses the GPT-3 chat API to answer questions");
        Assert.Equal(instance.instructions, """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some
personal flair with appropriate emojis.

# Customer
You are helping { { firstName} }
        { { lastName} }
        to find answers to
their questions. Use their name to address them in your responses.
user:
        { { question} }
        """);
    }
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        id: unique-agent-id
        version: 1.0.0
        name: basic-prompt
        description: A basic prompt that uses the GPT-3 chat API to answer questions
        metadata:
          authors:
            - sethjuarez
            - jietong
          tags:
            - example
            - prompt
        model:
          id: gpt-35-turbo
          connection:
            kind: key
            endpoint: https://{your-custom-endpoint}.openai.azure.com/
            key: "{your-api-key}"
        inputs:
          firstName:
            kind: string
            sample: Jane
          lastName:
            kind: string
            sample: Doe
          question:
            kind: string
            sample: What is the meaning of life?
        outputs:
          - name: answer
            kind: string
            description: The answer to the user's question.
        tools:
          getCurrentWeather:
            kind: function
            description: Get the current weather in a given location
            parameters:
              location:
                kind: string
                description: The city and state, e.g. San Francisco, CA
              unit:
                kind: string
                description: The unit of temperature, e.g. Celsius or Fahrenheit
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
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "id": "unique-agent-id",
          "version": "1.0.0",
          "name": "basic-prompt",
          "description": "A basic prompt that uses the GPT-3 chat API to answer questions",
          "metadata": {
            "authors": [
              "sethjuarez",
              "jietong"
            ],
            "tags": [
              "example",
              "prompt"
            ]
          },
          "model": {
            "id": "gpt-35-turbo",
            "connection": {
              "kind": "key",
              "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
              "key": "{your-api-key}"
            }
          },
          "inputs": {
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
          },
          "outputs": [
            {
              "name": "answer",
              "kind": "string",
              "description": "The answer to the user's question."
            }
          ],
          "tools": {
            "getCurrentWeather": {
              "kind": "function",
              "description": "Get the current weather in a given location",
              "parameters": {
                "location": {
                  "kind": "string",
                  "description": "The city and state, e.g. San Francisco, CA"
                },
                "unit": {
                  "kind": "string",
                  "description": "The unit of temperature, e.g. Celsius or Fahrenheit"
                }
              }
            }
          },
          "template": {
            "format": "mustache",
            "parser": "prompty"
          },
          "instructions": "system:\nYou are an AI assistant who helps people find information.\nAs the assistant, you answer questions briefly, succinctly,\nand in a personable manner using markdown and even add some \npersonal flair with appropriate emojis.\n\n# Customer\nYou are helping {{firstName}} {{lastName}} to find answers to \ntheir questions. Use their name to address them in your responses.\nuser:\n{{question}}"
        }
        """;

        var instance = JsonSerializer.Deserialize<Prompty>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.id, "unique-agent-id");
        Assert.Equal(instance.version, "1.0.0");
        Assert.Equal(instance.name, "basic-prompt");
        Assert.Equal(instance.description, "A basic prompt that uses the GPT-3 chat API to answer questions");
        Assert.Equal(instance.instructions, """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some
personal flair with appropriate emojis.

# Customer
You are helping { { firstName} }
        { { lastName} }
        to find answers to
their questions. Use their name to address them in your responses.
user:
        { { question} }
        """);
    }
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        id: unique-agent-id
        version: 1.0.0
        name: basic-prompt
        description: A basic prompt that uses the GPT-3 chat API to answer questions
        metadata:
          authors:
            - sethjuarez
            - jietong
          tags:
            - example
            - prompt
        model:
          id: gpt-35-turbo
          connection:
            kind: key
            endpoint: https://{your-custom-endpoint}.openai.azure.com/
            key: "{your-api-key}"
        inputs:
          - name: firstName
            kind: string
            sample: Jane
          - name: lastName
            kind: string
            sample: Doe
          - name: question
            kind: string
            sample: What is the meaning of life?
        outputs:
          answer:
            kind: string
            description: The answer to the user's question.
        tools:
          - name: getCurrentWeather
            kind: function
            description: Get the current weather in a given location
            parameters:
              location:
                kind: string
                description: The city and state, e.g. San Francisco, CA
              unit:
                kind: string
                description: The unit of temperature, e.g. Celsius or Fahrenheit
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
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "id": "unique-agent-id",
          "version": "1.0.0",
          "name": "basic-prompt",
          "description": "A basic prompt that uses the GPT-3 chat API to answer questions",
          "metadata": {
            "authors": [
              "sethjuarez",
              "jietong"
            ],
            "tags": [
              "example",
              "prompt"
            ]
          },
          "model": {
            "id": "gpt-35-turbo",
            "connection": {
              "kind": "key",
              "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
              "key": "{your-api-key}"
            }
          },
          "inputs": [
            {
              "name": "firstName",
              "kind": "string",
              "sample": "Jane"
            },
            {
              "name": "lastName",
              "kind": "string",
              "sample": "Doe"
            },
            {
              "name": "question",
              "kind": "string",
              "sample": "What is the meaning of life?"
            }
          ],
          "outputs": {
            "answer": {
              "kind": "string",
              "description": "The answer to the user's question."
            }
          },
          "tools": [
            {
              "name": "getCurrentWeather",
              "kind": "function",
              "description": "Get the current weather in a given location",
              "parameters": {
                "location": {
                  "kind": "string",
                  "description": "The city and state, e.g. San Francisco, CA"
                },
                "unit": {
                  "kind": "string",
                  "description": "The unit of temperature, e.g. Celsius or Fahrenheit"
                }
              }
            }
          ],
          "template": {
            "format": "mustache",
            "parser": "prompty"
          },
          "instructions": "system:\nYou are an AI assistant who helps people find information.\nAs the assistant, you answer questions briefly, succinctly,\nand in a personable manner using markdown and even add some \npersonal flair with appropriate emojis.\n\n# Customer\nYou are helping {{firstName}} {{lastName}} to find answers to \ntheir questions. Use their name to address them in your responses.\nuser:\n{{question}}"
        }
        """;

        var instance = JsonSerializer.Deserialize<Prompty>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.id, "unique-agent-id");
        Assert.Equal(instance.version, "1.0.0");
        Assert.Equal(instance.name, "basic-prompt");
        Assert.Equal(instance.description, "A basic prompt that uses the GPT-3 chat API to answer questions");
        Assert.Equal(instance.instructions, """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some
personal flair with appropriate emojis.

# Customer
You are helping { { firstName} }
        { { lastName} }
        to find answers to
their questions. Use their name to address them in your responses.
user:
        { { question} }
        """);
    }
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        id: unique-agent-id
        version: 1.0.0
        name: basic-prompt
        description: A basic prompt that uses the GPT-3 chat API to answer questions
        metadata:
          authors:
            - sethjuarez
            - jietong
          tags:
            - example
            - prompt
        model:
          id: gpt-35-turbo
          connection:
            kind: key
            endpoint: https://{your-custom-endpoint}.openai.azure.com/
            key: "{your-api-key}"
        inputs:
          - name: firstName
            kind: string
            sample: Jane
          - name: lastName
            kind: string
            sample: Doe
          - name: question
            kind: string
            sample: What is the meaning of life?
        outputs:
          answer:
            kind: string
            description: The answer to the user's question.
        tools:
          getCurrentWeather:
            kind: function
            description: Get the current weather in a given location
            parameters:
              location:
                kind: string
                description: The city and state, e.g. San Francisco, CA
              unit:
                kind: string
                description: The unit of temperature, e.g. Celsius or Fahrenheit
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
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "id": "unique-agent-id",
          "version": "1.0.0",
          "name": "basic-prompt",
          "description": "A basic prompt that uses the GPT-3 chat API to answer questions",
          "metadata": {
            "authors": [
              "sethjuarez",
              "jietong"
            ],
            "tags": [
              "example",
              "prompt"
            ]
          },
          "model": {
            "id": "gpt-35-turbo",
            "connection": {
              "kind": "key",
              "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
              "key": "{your-api-key}"
            }
          },
          "inputs": [
            {
              "name": "firstName",
              "kind": "string",
              "sample": "Jane"
            },
            {
              "name": "lastName",
              "kind": "string",
              "sample": "Doe"
            },
            {
              "name": "question",
              "kind": "string",
              "sample": "What is the meaning of life?"
            }
          ],
          "outputs": {
            "answer": {
              "kind": "string",
              "description": "The answer to the user's question."
            }
          },
          "tools": {
            "getCurrentWeather": {
              "kind": "function",
              "description": "Get the current weather in a given location",
              "parameters": {
                "location": {
                  "kind": "string",
                  "description": "The city and state, e.g. San Francisco, CA"
                },
                "unit": {
                  "kind": "string",
                  "description": "The unit of temperature, e.g. Celsius or Fahrenheit"
                }
              }
            }
          },
          "template": {
            "format": "mustache",
            "parser": "prompty"
          },
          "instructions": "system:\nYou are an AI assistant who helps people find information.\nAs the assistant, you answer questions briefly, succinctly,\nand in a personable manner using markdown and even add some \npersonal flair with appropriate emojis.\n\n# Customer\nYou are helping {{firstName}} {{lastName}} to find answers to \ntheir questions. Use their name to address them in your responses.\nuser:\n{{question}}"
        }
        """;

        var instance = JsonSerializer.Deserialize<Prompty>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.id, "unique-agent-id");
        Assert.Equal(instance.version, "1.0.0");
        Assert.Equal(instance.name, "basic-prompt");
        Assert.Equal(instance.description, "A basic prompt that uses the GPT-3 chat API to answer questions");
        Assert.Equal(instance.instructions, """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some
personal flair with appropriate emojis.

# Customer
You are helping { { firstName} }
        { { lastName} }
        to find answers to
their questions. Use their name to address them in your responses.
user:
        { { question} }
        """);
    }
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        id: unique-agent-id
        version: 1.0.0
        name: basic-prompt
        description: A basic prompt that uses the GPT-3 chat API to answer questions
        metadata:
          authors:
            - sethjuarez
            - jietong
          tags:
            - example
            - prompt
        model:
          id: gpt-35-turbo
          connection:
            kind: key
            endpoint: https://{your-custom-endpoint}.openai.azure.com/
            key: "{your-api-key}"
        inputs:
          - name: firstName
            kind: string
            sample: Jane
          - name: lastName
            kind: string
            sample: Doe
          - name: question
            kind: string
            sample: What is the meaning of life?
        outputs:
          - name: answer
            kind: string
            description: The answer to the user's question.
        tools:
          - name: getCurrentWeather
            kind: function
            description: Get the current weather in a given location
            parameters:
              location:
                kind: string
                description: The city and state, e.g. San Francisco, CA
              unit:
                kind: string
                description: The unit of temperature, e.g. Celsius or Fahrenheit
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
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "id": "unique-agent-id",
          "version": "1.0.0",
          "name": "basic-prompt",
          "description": "A basic prompt that uses the GPT-3 chat API to answer questions",
          "metadata": {
            "authors": [
              "sethjuarez",
              "jietong"
            ],
            "tags": [
              "example",
              "prompt"
            ]
          },
          "model": {
            "id": "gpt-35-turbo",
            "connection": {
              "kind": "key",
              "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
              "key": "{your-api-key}"
            }
          },
          "inputs": [
            {
              "name": "firstName",
              "kind": "string",
              "sample": "Jane"
            },
            {
              "name": "lastName",
              "kind": "string",
              "sample": "Doe"
            },
            {
              "name": "question",
              "kind": "string",
              "sample": "What is the meaning of life?"
            }
          ],
          "outputs": [
            {
              "name": "answer",
              "kind": "string",
              "description": "The answer to the user's question."
            }
          ],
          "tools": [
            {
              "name": "getCurrentWeather",
              "kind": "function",
              "description": "Get the current weather in a given location",
              "parameters": {
                "location": {
                  "kind": "string",
                  "description": "The city and state, e.g. San Francisco, CA"
                },
                "unit": {
                  "kind": "string",
                  "description": "The unit of temperature, e.g. Celsius or Fahrenheit"
                }
              }
            }
          ],
          "template": {
            "format": "mustache",
            "parser": "prompty"
          },
          "instructions": "system:\nYou are an AI assistant who helps people find information.\nAs the assistant, you answer questions briefly, succinctly,\nand in a personable manner using markdown and even add some \npersonal flair with appropriate emojis.\n\n# Customer\nYou are helping {{firstName}} {{lastName}} to find answers to \ntheir questions. Use their name to address them in your responses.\nuser:\n{{question}}"
        }
        """;

        var instance = JsonSerializer.Deserialize<Prompty>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.id, "unique-agent-id");
        Assert.Equal(instance.version, "1.0.0");
        Assert.Equal(instance.name, "basic-prompt");
        Assert.Equal(instance.description, "A basic prompt that uses the GPT-3 chat API to answer questions");
        Assert.Equal(instance.instructions, """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some
personal flair with appropriate emojis.

# Customer
You are helping { { firstName} }
        { { lastName} }
        to find answers to
their questions. Use their name to address them in your responses.
user:
        { { question} }
        """);
    }
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        id: unique-agent-id
        version: 1.0.0
        name: basic-prompt
        description: A basic prompt that uses the GPT-3 chat API to answer questions
        metadata:
          authors:
            - sethjuarez
            - jietong
          tags:
            - example
            - prompt
        model:
          id: gpt-35-turbo
          connection:
            kind: key
            endpoint: https://{your-custom-endpoint}.openai.azure.com/
            key: "{your-api-key}"
        inputs:
          - name: firstName
            kind: string
            sample: Jane
          - name: lastName
            kind: string
            sample: Doe
          - name: question
            kind: string
            sample: What is the meaning of life?
        outputs:
          - name: answer
            kind: string
            description: The answer to the user's question.
        tools:
          getCurrentWeather:
            kind: function
            description: Get the current weather in a given location
            parameters:
              location:
                kind: string
                description: The city and state, e.g. San Francisco, CA
              unit:
                kind: string
                description: The unit of temperature, e.g. Celsius or Fahrenheit
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
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "id": "unique-agent-id",
          "version": "1.0.0",
          "name": "basic-prompt",
          "description": "A basic prompt that uses the GPT-3 chat API to answer questions",
          "metadata": {
            "authors": [
              "sethjuarez",
              "jietong"
            ],
            "tags": [
              "example",
              "prompt"
            ]
          },
          "model": {
            "id": "gpt-35-turbo",
            "connection": {
              "kind": "key",
              "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
              "key": "{your-api-key}"
            }
          },
          "inputs": [
            {
              "name": "firstName",
              "kind": "string",
              "sample": "Jane"
            },
            {
              "name": "lastName",
              "kind": "string",
              "sample": "Doe"
            },
            {
              "name": "question",
              "kind": "string",
              "sample": "What is the meaning of life?"
            }
          ],
          "outputs": [
            {
              "name": "answer",
              "kind": "string",
              "description": "The answer to the user's question."
            }
          ],
          "tools": {
            "getCurrentWeather": {
              "kind": "function",
              "description": "Get the current weather in a given location",
              "parameters": {
                "location": {
                  "kind": "string",
                  "description": "The city and state, e.g. San Francisco, CA"
                },
                "unit": {
                  "kind": "string",
                  "description": "The unit of temperature, e.g. Celsius or Fahrenheit"
                }
              }
            }
          },
          "template": {
            "format": "mustache",
            "parser": "prompty"
          },
          "instructions": "system:\nYou are an AI assistant who helps people find information.\nAs the assistant, you answer questions briefly, succinctly,\nand in a personable manner using markdown and even add some \npersonal flair with appropriate emojis.\n\n# Customer\nYou are helping {{firstName}} {{lastName}} to find answers to \ntheir questions. Use their name to address them in your responses.\nuser:\n{{question}}"
        }
        """;

        var instance = JsonSerializer.Deserialize<Prompty>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.id, "unique-agent-id");
        Assert.Equal(instance.version, "1.0.0");
        Assert.Equal(instance.name, "basic-prompt");
        Assert.Equal(instance.description, "A basic prompt that uses the GPT-3 chat API to answer questions");
        Assert.Equal(instance.instructions, """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some
personal flair with appropriate emojis.

# Customer
You are helping { { firstName} }
        { { lastName} }
        to find answers to
their questions. Use their name to address them in your responses.
user:
        { { question} }
        """);
    }
}