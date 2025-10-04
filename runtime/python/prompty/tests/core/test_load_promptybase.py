import json

import yaml

from prompty.core import PromptyBase


def test_load_json_promptybase():
    json_data = """
    {
      "kind": "prompt",
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
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PromptyBase.load(data)
    assert instance is not None
    assert instance.kind == "prompt"
    assert instance.name == "basic-prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"


def test_load_yaml_promptybase():
    yaml_data = """
    kind: prompt
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = PromptyBase.load(data)
    assert instance is not None
    assert instance.kind == "prompt"
    assert instance.name == "basic-prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"


def test_load_json_promptybase_1():
    json_data = """
    {
      "kind": "prompt",
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
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PromptyBase.load(data)
    assert instance is not None
    assert instance.kind == "prompt"
    assert instance.name == "basic-prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"


def test_load_yaml_promptybase_1():
    yaml_data = """
    kind: prompt
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = PromptyBase.load(data)
    assert instance is not None
    assert instance.kind == "prompt"
    assert instance.name == "basic-prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"


def test_load_json_promptybase_2():
    json_data = """
    {
      "kind": "prompt",
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
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PromptyBase.load(data)
    assert instance is not None
    assert instance.kind == "prompt"
    assert instance.name == "basic-prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"


def test_load_yaml_promptybase_2():
    yaml_data = """
    kind: prompt
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = PromptyBase.load(data)
    assert instance is not None
    assert instance.kind == "prompt"
    assert instance.name == "basic-prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"


def test_load_json_promptybase_3():
    json_data = """
    {
      "kind": "prompt",
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
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PromptyBase.load(data)
    assert instance is not None
    assert instance.kind == "prompt"
    assert instance.name == "basic-prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"


def test_load_yaml_promptybase_3():
    yaml_data = """
    kind: prompt
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = PromptyBase.load(data)
    assert instance is not None
    assert instance.kind == "prompt"
    assert instance.name == "basic-prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"


def test_load_json_promptybase_4():
    json_data = """
    {
      "kind": "prompt",
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
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PromptyBase.load(data)
    assert instance is not None
    assert instance.kind == "prompt"
    assert instance.name == "basic-prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"


def test_load_yaml_promptybase_4():
    yaml_data = """
    kind: prompt
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = PromptyBase.load(data)
    assert instance is not None
    assert instance.kind == "prompt"
    assert instance.name == "basic-prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"


def test_load_json_promptybase_5():
    json_data = """
    {
      "kind": "prompt",
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
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PromptyBase.load(data)
    assert instance is not None
    assert instance.kind == "prompt"
    assert instance.name == "basic-prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"


def test_load_yaml_promptybase_5():
    yaml_data = """
    kind: prompt
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = PromptyBase.load(data)
    assert instance is not None
    assert instance.kind == "prompt"
    assert instance.name == "basic-prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"


def test_load_json_promptybase_6():
    json_data = """
    {
      "kind": "prompt",
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
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PromptyBase.load(data)
    assert instance is not None
    assert instance.kind == "prompt"
    assert instance.name == "basic-prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"


def test_load_yaml_promptybase_6():
    yaml_data = """
    kind: prompt
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = PromptyBase.load(data)
    assert instance is not None
    assert instance.kind == "prompt"
    assert instance.name == "basic-prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"


def test_load_json_promptybase_7():
    json_data = """
    {
      "kind": "prompt",
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
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PromptyBase.load(data)
    assert instance is not None
    assert instance.kind == "prompt"
    assert instance.name == "basic-prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"


def test_load_yaml_promptybase_7():
    yaml_data = """
    kind: prompt
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
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = PromptyBase.load(data)
    assert instance is not None
    assert instance.kind == "prompt"
    assert instance.name == "basic-prompt"
    assert instance.description == "A basic prompt that uses the GPT-3 chat API to answer questions"
