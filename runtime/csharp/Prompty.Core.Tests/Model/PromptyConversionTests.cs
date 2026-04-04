
using Xunit;

#pragma warning disable IDE0130
namespace Prompty;
#pragma warning restore IDE0130


public class PromptyConversionTests
{   
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  firstName:
    kind: string
    default: Jane
  lastName:
    kind: string
    default: Doe
  question:
    kind: string
    default: What is the meaning of life?
outputs:
  answer:
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var instance = Prompty.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("Basic Prompt", instance.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), instance.Instructions);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": {
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
  "outputs": {
    "answer": {
      "kind": "string",
      "description": "The answer to the user's question."
    }
  },
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var instance = Prompty.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("Basic Prompt", instance.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), instance.Instructions);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": {
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
  "outputs": {
    "answer": {
      "kind": "string",
      "description": "The answer to the user's question."
    }
  },
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var original = Prompty.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = Prompty.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("basic-prompt", reloaded.Name);
        Assert.Equal("Basic Prompt", reloaded.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", reloaded.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), reloaded.Instructions);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  firstName:
    kind: string
    default: Jane
  lastName:
    kind: string
    default: Doe
  question:
    kind: string
    default: What is the meaning of life?
outputs:
  answer:
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var original = Prompty.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = Prompty.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("basic-prompt", reloaded.Name);
        Assert.Equal("Basic Prompt", reloaded.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", reloaded.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), reloaded.Instructions);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": {
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
  "outputs": {
    "answer": {
      "kind": "string",
      "description": "The answer to the user's question."
    }
  },
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var instance = Prompty.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  firstName:
    kind: string
    default: Jane
  lastName:
    kind: string
    default: Doe
  question:
    kind: string
    default: What is the meaning of life?
outputs:
  answer:
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var instance = Prompty.FromYaml(yamlData);
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
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  firstName:
    kind: string
    default: Jane
  lastName:
    kind: string
    default: Doe
  question:
    kind: string
    default: What is the meaning of life?
outputs:
  answer:
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var instance = Prompty.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("Basic Prompt", instance.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), instance.Instructions);
    }

    [Fact]
    public void LoadJsonInput1()
    {
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": {
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
  "outputs": {
    "answer": {
      "kind": "string",
      "description": "The answer to the user's question."
    }
  },
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var instance = Prompty.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("Basic Prompt", instance.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), instance.Instructions);
    }

    [Fact]
    public void RoundtripJson1()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": {
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
  "outputs": {
    "answer": {
      "kind": "string",
      "description": "The answer to the user's question."
    }
  },
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var original = Prompty.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = Prompty.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("basic-prompt", reloaded.Name);
        Assert.Equal("Basic Prompt", reloaded.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", reloaded.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), reloaded.Instructions);
    }

    [Fact]
    public void RoundtripYaml1()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  firstName:
    kind: string
    default: Jane
  lastName:
    kind: string
    default: Doe
  question:
    kind: string
    default: What is the meaning of life?
outputs:
  answer:
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var original = Prompty.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = Prompty.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("basic-prompt", reloaded.Name);
        Assert.Equal("Basic Prompt", reloaded.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", reloaded.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), reloaded.Instructions);
    }

    [Fact]
    public void ToJsonProducesValidJson1()
    {
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": {
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
  "outputs": {
    "answer": {
      "kind": "string",
      "description": "The answer to the user's question."
    }
  },
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var instance = Prompty.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml1()
    {
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  firstName:
    kind: string
    default: Jane
  lastName:
    kind: string
    default: Doe
  question:
    kind: string
    default: What is the meaning of life?
outputs:
  answer:
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var instance = Prompty.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
    [Fact]
    public void LoadYamlInput2()
    {
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  firstName:
    kind: string
    default: Jane
  lastName:
    kind: string
    default: Doe
  question:
    kind: string
    default: What is the meaning of life?
outputs:
  - name: answer
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var instance = Prompty.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("Basic Prompt", instance.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), instance.Instructions);
    }

    [Fact]
    public void LoadJsonInput2()
    {
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": {
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
  "outputs": [
    {
      "name": "answer",
      "kind": "string",
      "description": "The answer to the user's question."
    }
  ],
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var instance = Prompty.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("Basic Prompt", instance.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), instance.Instructions);
    }

    [Fact]
    public void RoundtripJson2()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": {
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
  "outputs": [
    {
      "name": "answer",
      "kind": "string",
      "description": "The answer to the user's question."
    }
  ],
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var original = Prompty.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = Prompty.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("basic-prompt", reloaded.Name);
        Assert.Equal("Basic Prompt", reloaded.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", reloaded.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), reloaded.Instructions);
    }

    [Fact]
    public void RoundtripYaml2()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  firstName:
    kind: string
    default: Jane
  lastName:
    kind: string
    default: Doe
  question:
    kind: string
    default: What is the meaning of life?
outputs:
  - name: answer
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var original = Prompty.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = Prompty.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("basic-prompt", reloaded.Name);
        Assert.Equal("Basic Prompt", reloaded.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", reloaded.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), reloaded.Instructions);
    }

    [Fact]
    public void ToJsonProducesValidJson2()
    {
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": {
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
  "outputs": [
    {
      "name": "answer",
      "kind": "string",
      "description": "The answer to the user's question."
    }
  ],
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var instance = Prompty.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml2()
    {
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  firstName:
    kind: string
    default: Jane
  lastName:
    kind: string
    default: Doe
  question:
    kind: string
    default: What is the meaning of life?
outputs:
  - name: answer
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var instance = Prompty.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
    [Fact]
    public void LoadYamlInput3()
    {
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  firstName:
    kind: string
    default: Jane
  lastName:
    kind: string
    default: Doe
  question:
    kind: string
    default: What is the meaning of life?
outputs:
  - name: answer
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var instance = Prompty.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("Basic Prompt", instance.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), instance.Instructions);
    }

    [Fact]
    public void LoadJsonInput3()
    {
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": {
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
  "outputs": [
    {
      "name": "answer",
      "kind": "string",
      "description": "The answer to the user's question."
    }
  ],
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var instance = Prompty.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("Basic Prompt", instance.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), instance.Instructions);
    }

    [Fact]
    public void RoundtripJson3()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": {
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
  "outputs": [
    {
      "name": "answer",
      "kind": "string",
      "description": "The answer to the user's question."
    }
  ],
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var original = Prompty.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = Prompty.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("basic-prompt", reloaded.Name);
        Assert.Equal("Basic Prompt", reloaded.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", reloaded.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), reloaded.Instructions);
    }

    [Fact]
    public void RoundtripYaml3()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  firstName:
    kind: string
    default: Jane
  lastName:
    kind: string
    default: Doe
  question:
    kind: string
    default: What is the meaning of life?
outputs:
  - name: answer
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var original = Prompty.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = Prompty.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("basic-prompt", reloaded.Name);
        Assert.Equal("Basic Prompt", reloaded.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", reloaded.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), reloaded.Instructions);
    }

    [Fact]
    public void ToJsonProducesValidJson3()
    {
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": {
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
  "outputs": [
    {
      "name": "answer",
      "kind": "string",
      "description": "The answer to the user's question."
    }
  ],
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var instance = Prompty.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml3()
    {
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  firstName:
    kind: string
    default: Jane
  lastName:
    kind: string
    default: Doe
  question:
    kind: string
    default: What is the meaning of life?
outputs:
  - name: answer
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var instance = Prompty.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
    [Fact]
    public void LoadYamlInput4()
    {
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  - name: firstName
    kind: string
    default: Jane
  - name: lastName
    kind: string
    default: Doe
  - name: question
    kind: string
    default: What is the meaning of life?
outputs:
  answer:
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var instance = Prompty.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("Basic Prompt", instance.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), instance.Instructions);
    }

    [Fact]
    public void LoadJsonInput4()
    {
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": [
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
  "outputs": {
    "answer": {
      "kind": "string",
      "description": "The answer to the user's question."
    }
  },
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var instance = Prompty.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("Basic Prompt", instance.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), instance.Instructions);
    }

    [Fact]
    public void RoundtripJson4()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": [
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
  "outputs": {
    "answer": {
      "kind": "string",
      "description": "The answer to the user's question."
    }
  },
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var original = Prompty.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = Prompty.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("basic-prompt", reloaded.Name);
        Assert.Equal("Basic Prompt", reloaded.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", reloaded.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), reloaded.Instructions);
    }

    [Fact]
    public void RoundtripYaml4()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  - name: firstName
    kind: string
    default: Jane
  - name: lastName
    kind: string
    default: Doe
  - name: question
    kind: string
    default: What is the meaning of life?
outputs:
  answer:
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var original = Prompty.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = Prompty.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("basic-prompt", reloaded.Name);
        Assert.Equal("Basic Prompt", reloaded.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", reloaded.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), reloaded.Instructions);
    }

    [Fact]
    public void ToJsonProducesValidJson4()
    {
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": [
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
  "outputs": {
    "answer": {
      "kind": "string",
      "description": "The answer to the user's question."
    }
  },
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var instance = Prompty.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml4()
    {
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  - name: firstName
    kind: string
    default: Jane
  - name: lastName
    kind: string
    default: Doe
  - name: question
    kind: string
    default: What is the meaning of life?
outputs:
  answer:
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var instance = Prompty.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
    [Fact]
    public void LoadYamlInput5()
    {
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  - name: firstName
    kind: string
    default: Jane
  - name: lastName
    kind: string
    default: Doe
  - name: question
    kind: string
    default: What is the meaning of life?
outputs:
  answer:
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var instance = Prompty.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("Basic Prompt", instance.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), instance.Instructions);
    }

    [Fact]
    public void LoadJsonInput5()
    {
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": [
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
  "outputs": {
    "answer": {
      "kind": "string",
      "description": "The answer to the user's question."
    }
  },
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var instance = Prompty.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("Basic Prompt", instance.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), instance.Instructions);
    }

    [Fact]
    public void RoundtripJson5()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": [
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
  "outputs": {
    "answer": {
      "kind": "string",
      "description": "The answer to the user's question."
    }
  },
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var original = Prompty.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = Prompty.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("basic-prompt", reloaded.Name);
        Assert.Equal("Basic Prompt", reloaded.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", reloaded.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), reloaded.Instructions);
    }

    [Fact]
    public void RoundtripYaml5()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  - name: firstName
    kind: string
    default: Jane
  - name: lastName
    kind: string
    default: Doe
  - name: question
    kind: string
    default: What is the meaning of life?
outputs:
  answer:
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var original = Prompty.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = Prompty.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("basic-prompt", reloaded.Name);
        Assert.Equal("Basic Prompt", reloaded.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", reloaded.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), reloaded.Instructions);
    }

    [Fact]
    public void ToJsonProducesValidJson5()
    {
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": [
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
  "outputs": {
    "answer": {
      "kind": "string",
      "description": "The answer to the user's question."
    }
  },
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var instance = Prompty.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml5()
    {
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  - name: firstName
    kind: string
    default: Jane
  - name: lastName
    kind: string
    default: Doe
  - name: question
    kind: string
    default: What is the meaning of life?
outputs:
  answer:
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var instance = Prompty.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
    [Fact]
    public void LoadYamlInput6()
    {
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  - name: firstName
    kind: string
    default: Jane
  - name: lastName
    kind: string
    default: Doe
  - name: question
    kind: string
    default: What is the meaning of life?
outputs:
  - name: answer
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var instance = Prompty.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("Basic Prompt", instance.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), instance.Instructions);
    }

    [Fact]
    public void LoadJsonInput6()
    {
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": [
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
  "outputs": [
    {
      "name": "answer",
      "kind": "string",
      "description": "The answer to the user's question."
    }
  ],
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var instance = Prompty.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("Basic Prompt", instance.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), instance.Instructions);
    }

    [Fact]
    public void RoundtripJson6()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": [
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
  "outputs": [
    {
      "name": "answer",
      "kind": "string",
      "description": "The answer to the user's question."
    }
  ],
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var original = Prompty.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = Prompty.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("basic-prompt", reloaded.Name);
        Assert.Equal("Basic Prompt", reloaded.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", reloaded.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), reloaded.Instructions);
    }

    [Fact]
    public void RoundtripYaml6()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  - name: firstName
    kind: string
    default: Jane
  - name: lastName
    kind: string
    default: Doe
  - name: question
    kind: string
    default: What is the meaning of life?
outputs:
  - name: answer
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var original = Prompty.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = Prompty.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("basic-prompt", reloaded.Name);
        Assert.Equal("Basic Prompt", reloaded.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", reloaded.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), reloaded.Instructions);
    }

    [Fact]
    public void ToJsonProducesValidJson6()
    {
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": [
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
  "outputs": [
    {
      "name": "answer",
      "kind": "string",
      "description": "The answer to the user's question."
    }
  ],
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var instance = Prompty.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml6()
    {
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  - name: firstName
    kind: string
    default: Jane
  - name: lastName
    kind: string
    default: Doe
  - name: question
    kind: string
    default: What is the meaning of life?
outputs:
  - name: answer
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var instance = Prompty.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
    [Fact]
    public void LoadYamlInput7()
    {
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  - name: firstName
    kind: string
    default: Jane
  - name: lastName
    kind: string
    default: Doe
  - name: question
    kind: string
    default: What is the meaning of life?
outputs:
  - name: answer
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var instance = Prompty.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("Basic Prompt", instance.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), instance.Instructions);
    }

    [Fact]
    public void LoadJsonInput7()
    {
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": [
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
  "outputs": [
    {
      "name": "answer",
      "kind": "string",
      "description": "The answer to the user's question."
    }
  ],
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var instance = Prompty.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("Basic Prompt", instance.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), instance.Instructions);
    }

    [Fact]
    public void RoundtripJson7()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": [
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
  "outputs": [
    {
      "name": "answer",
      "kind": "string",
      "description": "The answer to the user's question."
    }
  ],
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var original = Prompty.FromJson(jsonData);
        Assert.NotNull(original);
        
        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));
        
        var reloaded = Prompty.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("basic-prompt", reloaded.Name);
        Assert.Equal("Basic Prompt", reloaded.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", reloaded.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), reloaded.Instructions);
    }

    [Fact]
    public void RoundtripYaml7()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  - name: firstName
    kind: string
    default: Jane
  - name: lastName
    kind: string
    default: Doe
  - name: question
    kind: string
    default: What is the meaning of life?
outputs:
  - name: answer
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var original = Prompty.FromYaml(yamlData);
        Assert.NotNull(original);
        
        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));
        
        var reloaded = Prompty.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("basic-prompt", reloaded.Name);
        Assert.Equal("Basic Prompt", reloaded.DisplayName);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", reloaded.Description);
        Assert.Equal(@"system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}".Replace("\r\n", "\n"), reloaded.Instructions);
    }

    [Fact]
    public void ToJsonProducesValidJson7()
    {
        string jsonData = """
{
  "name": "basic-prompt",
  "displayName": "Basic Prompt",
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
  "inputs": [
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
  "outputs": [
    {
      "name": "answer",
      "kind": "string",
      "description": "The answer to the user's question."
    }
  ],
  "model": {
    "id": "gpt-35-turbo",
    "connection": {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "{your-api-key}"
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

        var instance = Prompty.FromJson(jsonData);
        var json = instance.ToJson();
        
        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml7()
    {
        string yamlData = """
name: basic-prompt
displayName: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong
  tags:
    - example
    - prompt
inputs:
  - name: firstName
    kind: string
    default: Jane
  - name: lastName
    kind: string
    default: Doe
  - name: question
    kind: string
    default: What is the meaning of life?
outputs:
  - name: answer
    kind: string
    description: The answer to the user's question.
model:
  id: gpt-35-turbo
  connection:
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: "{your-api-key}"
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
instructions: "system:

  You are an AI assistant who helps people find information.

  As the assistant, you answer questions briefly, succinctly,

  and in a personable manner using markdown and even add some\ 

  personal flair with appropriate emojis.


  # Customer

  You are helping {{firstName}} {{lastName}} to find answers to\ 

  their questions. Use their name to address them in your responses.

  user:

  {{question}}"

""";

        var instance = Prompty.FromYaml(yamlData);
        var yaml = instance.ToYaml();
        
        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
