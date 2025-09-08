# Prompty

The following is a specification for defining AI agents with structured metadata, inputs, outputs, tools, and templates.
It provides a way to create reusable and composable AI agents that can be executed with specific configurations.
The specification includes metadata about the agent, model configuration, input parameters, expected outputs,
available tools, and template configurations for prompt rendering.

These can be written in a markdown format or in a pure YAML format.

## Class Diagram

```mermaid
---
title: Prompty
---
classDiagram
    class Prompty {
        +string kind
        +string id
        +string version
        +string name
        +string description
        +dictionary metadata
        +Model model
        +Input[] inputs
        +Output[] outputs
        +Tool[] tools
        +Template template
        +string instructions
        +string additional_instructions
    }
    class Model {
        +string id
        +string provider
        +Connection connection
        +ModelOptions options
    }
    Prompty *-- Model
    class Input {
        +string name
        +string kind
        +string description
        +boolean required
        +boolean strict
        +unknown default
        +unknown sample
    }
    Prompty *-- Input
    class Output {
        +string name
        +string kind
        +string description
        +boolean required
    }
    Prompty *-- Output
    class Tool {
        +string name
        +string kind
        +string description
        +Binding[] bindings
    }
    Prompty *-- Tool
    class Template {
        +string format
        +string parser
        +boolean strict
        +dictionary options
    }
    Prompty *-- Template
```

## Markdown Example
```markdown
---
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
    provider: azure
    type: chat
    endpoint: https://{your-custom-endpoint}.openai.azure.com/
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
template:
  format: handlebars
  parser: prompty
---
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
```



## Yaml Example
```yaml
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
    provider: azure
    type: chat
    endpoint: https://{your-custom-endpoint}.openai.azure.com/
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
template:
  format: handlebars
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

```




## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | Kind represented by the document  |
| id | string | Unique identifier for the document  |
| version | string | Document version  |
| name | string | Human-readable name of the agent  |
| description | string | Description of the agent&#39;s capabilities and purpose  |
| metadata | dictionary | Additional metadata including authors, tags, and other arbitrary properties  |
| model | [Model](Model.md) | Model configuration used for execution  |
| inputs | [Input Collection](Input.md) | Input parameters that participate in template rendering <p>Related Types:<ul><li>[ArrayInput](ArrayInput.md)</li><li>[ObjectInput](ObjectInput.md)</li></ul></p> |
| outputs | [Output Collection](Output.md) | Expected output format and structure from the agent <p>Related Types:<ul><li>[ArrayOutput](ArrayOutput.md)</li><li>[ObjectOutput](ObjectOutput.md)</li></ul></p> |
| tools | [Tool Collection](Tool.md) | Tools available to the agent for extended functionality <p>Related Types:<ul><li>[FunctionTool](FunctionTool.md)</li><li>[ServerTool](ServerTool.md)</li><li>[BingSearchTool](BingSearchTool.md)</li><li>[FileSearchTool](FileSearchTool.md)</li><li>[McpTool](McpTool.md)</li></ul></p> |
| template | [Template](Template.md) | Template configuration for prompt rendering  |
| instructions | string | Give your agent clear directions on what to do and how to do it. Include specific tasks, their order, and any special instructions like tone or engagement style. (can use this for a pure yaml declaration or as content in the markdown format)  |
| additional_instructions | string | Additional instructions or context for the agent, can be used to provide extra guidance (can use this for a pure yaml declaration)  |



