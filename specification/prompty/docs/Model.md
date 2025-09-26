# Model

Model for defining the structure and behavior of AI agents.
This model includes properties for specifying the model&#39;s provider, connection details, and various options.
It allows for flexible configuration of AI models to suit different use cases and requirements.

## Class Diagram

```mermaid
---
title: Model
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class Model {
      
        +string id
        +string publisher
        +Connection connection
        +ModelOptions options
    }
    class Connection {
        +string kind
        +string authority
        +string usageDescription
    }
    Model *-- Connection
    class ModelOptions {
        +string kind
    }
    Model *-- ModelOptions
```

## Yaml Example

```yaml
id: gpt-35-turbo
publisher: azure
connection:
  kind: key
  endpoint: https://{your-custom-endpoint}.openai.azure.com/
  key: "{your-api-key}"
options:
  type: chat
  temperature: 0.7
  maxTokens: 1000

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| id | string | The unique identifier of the model - can be used as the single property shorthand  |
| publisher | string | The publisher of the model (e.g., &#39;openai&#39;, &#39;azure&#39;, &#39;anthropic&#39;)  |
| connection | [Connection](Connection.md) | The connection configuration for the model (Related Types: [GenericConnection](GenericConnection.md), [ReferenceConnection](ReferenceConnection.md), [KeyConnection](KeyConnection.md), [OAuthConnection](OAuthConnection.md), [FoundryConnection](FoundryConnection.md)) |
| options | [ModelOptions](ModelOptions.md) | Additional options for the model  |

## Composed Types

The following types are composed within `Model`:

- [Connection](Connection.md)
- [ModelOptions](ModelOptions.md)

## Alternate Constructions

The following alternate constructions are available for `Model`.
These allow for simplified creation of instances using a single property.

### string model

Simple construction with just an id

The following simplified representation can be used:

```yaml
model: "example"

```

This is equivalent to the full representation:

```yaml
model:
  id: "example"

```
