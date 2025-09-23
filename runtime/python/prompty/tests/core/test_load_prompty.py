import json

import yaml

from prompty.core import Prompty


def test_create_prompty():
    instance = Prompty()
    assert instance is not None


def test_load_json_prompty():
    json_data = """
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.id == "unique-agent-id"
    assert instance.version == "1.0.0"
    assert instance.name == "basic-prompt"
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
    yaml_data = """
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.id == "unique-agent-id"
    assert instance.version == "1.0.0"
    assert instance.name == "basic-prompt"
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


def test_load_json_prompty_1():
    json_data = """
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.id == "unique-agent-id"
    assert instance.version == "1.0.0"
    assert instance.name == "basic-prompt"
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
    yaml_data = """
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.id == "unique-agent-id"
    assert instance.version == "1.0.0"
    assert instance.name == "basic-prompt"
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


def test_load_json_prompty_2():
    json_data = """
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.id == "unique-agent-id"
    assert instance.version == "1.0.0"
    assert instance.name == "basic-prompt"
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
    yaml_data = """
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.id == "unique-agent-id"
    assert instance.version == "1.0.0"
    assert instance.name == "basic-prompt"
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


def test_load_json_prompty_3():
    json_data = """
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.id == "unique-agent-id"
    assert instance.version == "1.0.0"
    assert instance.name == "basic-prompt"
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
    yaml_data = """
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.id == "unique-agent-id"
    assert instance.version == "1.0.0"
    assert instance.name == "basic-prompt"
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


def test_load_json_prompty_4():
    json_data = """
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.id == "unique-agent-id"
    assert instance.version == "1.0.0"
    assert instance.name == "basic-prompt"
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
    yaml_data = """
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.id == "unique-agent-id"
    assert instance.version == "1.0.0"
    assert instance.name == "basic-prompt"
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


def test_load_json_prompty_5():
    json_data = """
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.id == "unique-agent-id"
    assert instance.version == "1.0.0"
    assert instance.name == "basic-prompt"
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
    yaml_data = """
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.id == "unique-agent-id"
    assert instance.version == "1.0.0"
    assert instance.name == "basic-prompt"
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


def test_load_json_prompty_6():
    json_data = """
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.id == "unique-agent-id"
    assert instance.version == "1.0.0"
    assert instance.name == "basic-prompt"
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
    yaml_data = """
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.id == "unique-agent-id"
    assert instance.version == "1.0.0"
    assert instance.name == "basic-prompt"
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


def test_load_json_prompty_7():
    json_data = """
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
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.id == "unique-agent-id"
    assert instance.version == "1.0.0"
    assert instance.name == "basic-prompt"
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
    yaml_data = """
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.id == "unique-agent-id"
    assert instance.version == "1.0.0"
    assert instance.name == "basic-prompt"
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
