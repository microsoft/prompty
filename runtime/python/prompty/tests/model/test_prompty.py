import json

import yaml

from prompty.model import Prompty


def test_load_json_prompty():
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.name == "basic-prompt"
    assert instance.displayName == "Basic Prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        instance.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_load_yaml_prompty():
    yaml_data = r"""
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.name == "basic-prompt"
    assert instance.displayName == "Basic Prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        instance.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_roundtrip_json_prompty():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
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
    """
    original_data = json.loads(json_data, strict=False)
    instance = Prompty.load(original_data)
    saved_data = instance.save()
    reloaded = Prompty.load(saved_data)
    assert reloaded is not None
    assert reloaded.name == "basic-prompt"
    assert reloaded.displayName == "Basic Prompt"
    assert reloaded.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        reloaded.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_to_json_prompty():
    """Test that to_json produces valid JSON."""
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_prompty():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)


def test_load_json_prompty_1():
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.name == "basic-prompt"
    assert instance.displayName == "Basic Prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        instance.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_load_yaml_prompty_1():
    yaml_data = r"""
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.name == "basic-prompt"
    assert instance.displayName == "Basic Prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        instance.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_roundtrip_json_prompty_1():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
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
    """
    original_data = json.loads(json_data, strict=False)
    instance = Prompty.load(original_data)
    saved_data = instance.save()
    reloaded = Prompty.load(saved_data)
    assert reloaded is not None
    assert reloaded.name == "basic-prompt"
    assert reloaded.displayName == "Basic Prompt"
    assert reloaded.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        reloaded.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_to_json_prompty_1():
    """Test that to_json produces valid JSON."""
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_prompty_1():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)


def test_load_json_prompty_2():
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.name == "basic-prompt"
    assert instance.displayName == "Basic Prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        instance.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_load_yaml_prompty_2():
    yaml_data = r"""
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.name == "basic-prompt"
    assert instance.displayName == "Basic Prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        instance.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_roundtrip_json_prompty_2():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
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
    """
    original_data = json.loads(json_data, strict=False)
    instance = Prompty.load(original_data)
    saved_data = instance.save()
    reloaded = Prompty.load(saved_data)
    assert reloaded is not None
    assert reloaded.name == "basic-prompt"
    assert reloaded.displayName == "Basic Prompt"
    assert reloaded.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        reloaded.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_to_json_prompty_2():
    """Test that to_json produces valid JSON."""
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_prompty_2():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)


def test_load_json_prompty_3():
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.name == "basic-prompt"
    assert instance.displayName == "Basic Prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        instance.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_load_yaml_prompty_3():
    yaml_data = r"""
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.name == "basic-prompt"
    assert instance.displayName == "Basic Prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        instance.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_roundtrip_json_prompty_3():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
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
    """
    original_data = json.loads(json_data, strict=False)
    instance = Prompty.load(original_data)
    saved_data = instance.save()
    reloaded = Prompty.load(saved_data)
    assert reloaded is not None
    assert reloaded.name == "basic-prompt"
    assert reloaded.displayName == "Basic Prompt"
    assert reloaded.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        reloaded.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_to_json_prompty_3():
    """Test that to_json produces valid JSON."""
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_prompty_3():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)


def test_load_json_prompty_4():
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.name == "basic-prompt"
    assert instance.displayName == "Basic Prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        instance.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_load_yaml_prompty_4():
    yaml_data = r"""
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.name == "basic-prompt"
    assert instance.displayName == "Basic Prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        instance.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_roundtrip_json_prompty_4():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
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
    """
    original_data = json.loads(json_data, strict=False)
    instance = Prompty.load(original_data)
    saved_data = instance.save()
    reloaded = Prompty.load(saved_data)
    assert reloaded is not None
    assert reloaded.name == "basic-prompt"
    assert reloaded.displayName == "Basic Prompt"
    assert reloaded.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        reloaded.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_to_json_prompty_4():
    """Test that to_json produces valid JSON."""
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_prompty_4():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)


def test_load_json_prompty_5():
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.name == "basic-prompt"
    assert instance.displayName == "Basic Prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        instance.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_load_yaml_prompty_5():
    yaml_data = r"""
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.name == "basic-prompt"
    assert instance.displayName == "Basic Prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        instance.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_roundtrip_json_prompty_5():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
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
    """
    original_data = json.loads(json_data, strict=False)
    instance = Prompty.load(original_data)
    saved_data = instance.save()
    reloaded = Prompty.load(saved_data)
    assert reloaded is not None
    assert reloaded.name == "basic-prompt"
    assert reloaded.displayName == "Basic Prompt"
    assert reloaded.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        reloaded.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_to_json_prompty_5():
    """Test that to_json produces valid JSON."""
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_prompty_5():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)


def test_load_json_prompty_6():
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.name == "basic-prompt"
    assert instance.displayName == "Basic Prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        instance.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_load_yaml_prompty_6():
    yaml_data = r"""
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.name == "basic-prompt"
    assert instance.displayName == "Basic Prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        instance.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_roundtrip_json_prompty_6():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
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
    """
    original_data = json.loads(json_data, strict=False)
    instance = Prompty.load(original_data)
    saved_data = instance.save()
    reloaded = Prompty.load(saved_data)
    assert reloaded is not None
    assert reloaded.name == "basic-prompt"
    assert reloaded.displayName == "Basic Prompt"
    assert reloaded.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        reloaded.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_to_json_prompty_6():
    """Test that to_json produces valid JSON."""
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_prompty_6():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)


def test_load_json_prompty_7():
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.name == "basic-prompt"
    assert instance.displayName == "Basic Prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        instance.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_load_yaml_prompty_7():
    yaml_data = r"""
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.name == "basic-prompt"
    assert instance.displayName == "Basic Prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        instance.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_roundtrip_json_prompty_7():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
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
    """
    original_data = json.loads(json_data, strict=False)
    instance = Prompty.load(original_data)
    saved_data = instance.save()
    reloaded = Prompty.load(saved_data)
    assert reloaded is not None
    assert reloaded.name == "basic-prompt"
    assert reloaded.displayName == "Basic Prompt"
    assert reloaded.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
    assert (
        reloaded.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_to_json_prompty_7():
    """Test that to_json produces valid JSON."""
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_prompty_7():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
