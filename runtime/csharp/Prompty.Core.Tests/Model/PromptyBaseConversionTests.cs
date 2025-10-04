using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class PromptyBaseConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
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
        
        """;

        var instance = YamlSerializer.Deserialize<PromptyBase>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("prompt", instance.Kind);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
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
        """;

        var instance = JsonSerializer.Deserialize<PromptyBase>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("prompt", instance.Kind);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
    }
    [Fact]
    public void LoadYamlInput1()
    {
        string yamlData = """
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
        
        """;

        var instance = YamlSerializer.Deserialize<PromptyBase>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("prompt", instance.Kind);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
    }

    [Fact]
    public void LoadJsonInput1()
    {
        string jsonData = """
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
        """;

        var instance = JsonSerializer.Deserialize<PromptyBase>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("prompt", instance.Kind);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
    }
    [Fact]
    public void LoadYamlInput2()
    {
        string yamlData = """
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
        
        """;

        var instance = YamlSerializer.Deserialize<PromptyBase>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("prompt", instance.Kind);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
    }

    [Fact]
    public void LoadJsonInput2()
    {
        string jsonData = """
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
        """;

        var instance = JsonSerializer.Deserialize<PromptyBase>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("prompt", instance.Kind);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
    }
    [Fact]
    public void LoadYamlInput3()
    {
        string yamlData = """
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
        
        """;

        var instance = YamlSerializer.Deserialize<PromptyBase>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("prompt", instance.Kind);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
    }

    [Fact]
    public void LoadJsonInput3()
    {
        string jsonData = """
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
        """;

        var instance = JsonSerializer.Deserialize<PromptyBase>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("prompt", instance.Kind);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
    }
    [Fact]
    public void LoadYamlInput4()
    {
        string yamlData = """
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
        
        """;

        var instance = YamlSerializer.Deserialize<PromptyBase>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("prompt", instance.Kind);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
    }

    [Fact]
    public void LoadJsonInput4()
    {
        string jsonData = """
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
        """;

        var instance = JsonSerializer.Deserialize<PromptyBase>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("prompt", instance.Kind);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
    }
    [Fact]
    public void LoadYamlInput5()
    {
        string yamlData = """
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
        
        """;

        var instance = YamlSerializer.Deserialize<PromptyBase>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("prompt", instance.Kind);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
    }

    [Fact]
    public void LoadJsonInput5()
    {
        string jsonData = """
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
        """;

        var instance = JsonSerializer.Deserialize<PromptyBase>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("prompt", instance.Kind);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
    }
    [Fact]
    public void LoadYamlInput6()
    {
        string yamlData = """
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
        
        """;

        var instance = YamlSerializer.Deserialize<PromptyBase>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("prompt", instance.Kind);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
    }

    [Fact]
    public void LoadJsonInput6()
    {
        string jsonData = """
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
        """;

        var instance = JsonSerializer.Deserialize<PromptyBase>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("prompt", instance.Kind);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
    }
    [Fact]
    public void LoadYamlInput7()
    {
        string yamlData = """
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
        
        """;

        var instance = YamlSerializer.Deserialize<PromptyBase>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("prompt", instance.Kind);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
    }

    [Fact]
    public void LoadJsonInput7()
    {
        string jsonData = """
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
        """;

        var instance = JsonSerializer.Deserialize<PromptyBase>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("prompt", instance.Kind);
        Assert.Equal("basic-prompt", instance.Name);
        Assert.Equal("A basic prompt that uses the GPT-3 chat API to answer questions", instance.Description);
    }
}