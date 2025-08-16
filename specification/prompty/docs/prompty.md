# Prompty

Prompty is a specification for defining AI agents with structured metadata, inputs, outputs, tools, and templates.
It provides a way to create reusable and composable AI agents that can be executed with specific configurations.
The specification includes metadata about the agent, model configuration, input parameters, expected outputs,
available tools, and template configurations for prompt rendering.

These can be written in a markdown format or in a pure YAML format.

## Markdown Example

```markdown
---
name: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong

model:
  api: chat
  connection:
    azure_deployment: gpt-35-turbo

inputs:
  firstName:
    type: string
    description: The first name of the customer.
    sample: Jane
    default: Jane
    required: true
  lastName: Doe
  question: What is the meaning of life?

template:
  format: jinja2
  parser: prompty
---
system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to their questions.
Use their name to address them in your responses.

user:
{{question}}
```

## Yaml Example

```yaml
name: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
metadata:
  authors:
    - sethjuarez
    - jietong

model:
  api: chat
  connection:
    azure_deployment: gpt-35-turbo

inputs:
  firstName:
    type: string
    description: The first name of the customer.
    sample: Jane
    default: Jane
    required: true
  lastName: Doe
  question: What is the meaning of life?

template:
  format: jinja2
  parser: prompty

instructions: |
  system:
  You are an AI assistant who helps people find information.
  As the assistant, you answer questions briefly, succinctly,
  and in a personable manner using markdown and even add some personal flair with appropriate emojis.

  # Customer
  You are helping {{firstName}} {{lastName}} to find answers to their questions.
  Use their name to address them in your responses.

  user:
  {{question}}
```


## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| id |  string | Unique identifier for the Prompty document |
| version |  string | Version of the Prompty specification |
| name |  string | Human-readable name of the agent |
| description |  string | Description of the agent&#39;s capabilities and purpose |
| metadata |  [Metadata](metadata.md) | Additional metadata including authors, tags, and other arbitrary properties |
| model |  [Model](model.md) | Model configuration used for execution |
| inputs |  [Input Collection](inputs.md) | Input parameters that participate in template rendering |
| outputs |  [Output Collection](outputs.md) | Expected output format and structure from the agent |
| tools |  [Tool Collection](tools.md) | Tools available to the agent for extended functionality |
| template |  [Template](template.md) | Template configuration for prompt rendering |
| instructions |  string | Give your agent clear directions on what to do and how to do it. Include specific tasks, their order, and any special instructions like tone or engagement style. (can use this for a pure yaml declaration or as content in the markdown format) |
| additional_instructions |  string | Additional instructions or context for the agent, can be used to provide extra guidance (can use this for a pure yaml declaration) |

