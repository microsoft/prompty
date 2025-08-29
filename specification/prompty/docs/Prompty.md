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
    class Metadata {
    }
    class Options {
    }
    class BingSearchConfiguration {
        +string connectionId
        +string instanceName
        +string market
        +string setLang
        +int64 count
        +string freshness
    }
    class BingSearchOptions {
        +BingSearchConfiguration[] configurations
    }
    class FileSearchRankingOptions {
        +string ranker
        +float32 scoreThreshold
    }
    class FileSearchOptions {
        +int32 maxNumResults
        +FileSearchRankingOptions rankingOptions
    }
    class Authentication {
        +string type
        +Options credentials
    }
    class McpToolOptions {
        +string name
        +string url
        +string[] allowed
        +Authentication authentication
    }
    class Connection {
        +string provider
        +string type
        +string endpoint
        +Options options
    }
    class Model {
        +string id
        +Connection connection
    }
    class Input {
        +string name
        +string type
        +string description
        +boolean required
        +boolean strict
        +unknown default
        +unknown sample
    }
    class Output {
        +string name
        +string type
        +string description
        +boolean required
    }
    class ObjectOutput {
        +string type
        +Output[] properties
    }
    class ArrayOutput {
        +string type
        +Output items
    }
    class Binding {
        +string name
        +string input
    }
    class Tool {
        +string name
        +string type
        +string description
        +Binding[] bindings
    }
    class Parameter {
        +string name
        +string type
        +string description
        +boolean required
        +unknown[] enum
    }
    class ArrayParameter {
        +string type
        +Parameter items
    }
    class ObjectParameter {
        +string type
        +Parameter[] properties
    }
    class FunctionTool {
        +string type
        +Parameter[] parameters
    }
    class ServerTool {
        +string type
        +Options options
    }
    class BingSearchTool {
        +string type
        +BingSearchOptions options
    }
    class FileSearchTool {
        +string type
        +FileSearchOptions options
    }
    class McpTool {
        +string type
        +McpToolOptions options
    }
    class Template {
        +string format
        +string parser
        +boolean strict
        +Options options
    }
    class Prompty {
        +string id
        +string version
        +string name
        +string description
        +Metadata metadata
        +Model model
        +Input[] inputs
        +Output[] outputs
        +Tool[] tools
        +Template template
        +string instructions
        +string additional_instructions
    }
    Prompty *-- Metadata
    Prompty *-- Model
    Prompty *-- Input
    Prompty *-- Output
    Output *-- ArrayOutput
    Output *-- ObjectOutput
    Prompty *-- Tool
    Tool *-- FunctionTool
    Tool *-- ServerTool
    Tool *-- BingSearchTool
    Tool *-- FileSearchTool
    Tool *-- McpTool
    Prompty *-- Template
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
    type: string
    sample: Jane
  lastName:
    type: string
    sample: Doe
  question:
    type: string
    sample: What is the meaning of life?
outputs:
  answer:
    type: string
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
| id | string | Unique identifier for the Prompty document  |
| version | string | Version of the Prompty specification  |
| name | string | Human-readable name of the agent  |
| description | string | Description of the agent&#39;s capabilities and purpose  |
| metadata | [Metadata](Metadata.md) | Additional metadata including authors, tags, and other arbitrary properties  |
| model | [Model](Model.md) | Model configuration used for execution  |
| inputs | [Input Collection](Input.md) | Input parameters that participate in template rendering  |
| outputs | [Output Collection](Output.md) | Expected output format and structure from the agent <p>Related Types:<ul><li>[ArrayOutput](ArrayOutput.md)</li><li>[ObjectOutput](ObjectOutput.md)</li></ul></p> |
| tools | [Tool Collection](Tool.md) | Tools available to the agent for extended functionality <p>Related Types:<ul><li>[FunctionTool](FunctionTool.md)</li><li>[ServerTool](ServerTool.md)</li><li>[BingSearchTool](BingSearchTool.md)</li><li>[FileSearchTool](FileSearchTool.md)</li><li>[McpTool](McpTool.md)</li></ul></p> |
| template | [Template](Template.md) | Template configuration for prompt rendering  |
| instructions | string | Give your agent clear directions on what to do and how to do it. Include specific tasks, their order, and any special instructions like tone or engagement style. (can use this for a pure yaml declaration or as content in the markdown format)  |
| additional_instructions | string | Additional instructions or context for the agent, can be used to provide extra guidance (can use this for a pure yaml declaration)  |


