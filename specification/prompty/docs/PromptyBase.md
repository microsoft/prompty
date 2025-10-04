# PromptyBase

The following is a specification for defining AI agents with structured metadata, inputs, outputs, tools, and templates.
It provides a way to create reusable and composable AI agents that can be executed with specific configurations.
The specification includes metadata about the agent, model configuration, input parameters, expected outputs,
available tools, and template configurations for prompt rendering.

## Class Diagram

```mermaid
---
title: PromptyBase
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class PromptyBase {
      <<abstract>>
        +string kind
        +string name
        +string description
        +dictionary metadata
        +Model model
        +Input[] inputs
        +Output[] outputs
        +Tool[] tools
    }
    class Prompty {
        +string kind
        +Template template
        +string instructions
        +string additionalInstructions
    }
    PromptyBase <|-- Prompty
    class PromptyContainer {
        +string kind
        +string protocol
        +ContainerDefinition container
        +EnvironmentVariable[] environmentVariables
    }
    PromptyBase <|-- PromptyContainer
    class PromptyHostedContainer {
        +string kind
        +string protocol
        +HostedContainerDefinition container
        +EnvironmentVariable[] environmentVariables
    }
    PromptyBase <|-- PromptyHostedContainer
    class PromptyWorkflow {
        +string kind
        +dictionary trigger
    }
    PromptyBase <|-- PromptyWorkflow
    class Model {
        +string id
        +string publisher
        +Connection connection
        +ModelOptions options
    }
    PromptyBase *-- Model
    class Input {
        +string name
        +string kind
        +string description
        +boolean required
        +boolean strict
        +unknown default
        +unknown sample
    }
    PromptyBase *-- Input
    class Output {
        +string name
        +string kind
        +string description
        +boolean required
    }
    PromptyBase *-- Output
    class Tool {
        +string name
        +string kind
        +string description
        +Binding[] bindings
    }
    PromptyBase *-- Tool
```

## Yaml Example

```yaml
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

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | Kind represented by the document  |
| name | string | Human-readable name of the agent  |
| description | string | Description of the agent&#39;s capabilities and purpose  |
| metadata | dictionary | Additional metadata including authors, tags, and other arbitrary properties  |
| model | [Model](Model.md) | Primary AI model configuration for the agent  |
| inputs | [Input[]](Input.md) | Input parameters that participate in template rendering (Related Types: [ArrayInput](ArrayInput.md), [ObjectInput](ObjectInput.md)) |
| outputs | [Output[]](Output.md) | Expected output format and structure from the agent (Related Types: [ArrayOutput](ArrayOutput.md), [ObjectOutput](ObjectOutput.md)) |
| tools | [Tool[]](Tool.md) | Tools available to the agent for extended functionality (Related Types: [FunctionTool](FunctionTool.md), [ServerTool](ServerTool.md), [BingSearchTool](BingSearchTool.md), [FileSearchTool](FileSearchTool.md), [McpTool](McpTool.md), [ModelTool](ModelTool.md), [OpenApiTool](OpenApiTool.md), [CodeInterpreterTool](CodeInterpreterTool.md)) |

## Child Types

The following types extend `PromptyBase`:

- [Prompty](Prompty.md)
- [PromptyContainer](PromptyContainer.md)
- [PromptyHostedContainer](PromptyHostedContainer.md)
- [PromptyWorkflow](PromptyWorkflow.md)

## Composed Types

The following types are composed within `PromptyBase`:

- [Model](Model.md)
- [Input](Input.md)
- [Output](Output.md)
- [Tool](Tool.md)
