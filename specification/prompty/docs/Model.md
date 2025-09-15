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
        +string provider
        +Connection connection
        +ModelOptions options
    }
    class ModelOptions {
        +string kind
    }
    Model *-- ModelOptions
```

## Yaml Example

```yaml
id: gpt-35-turbo
provider: azure
connection:
  authType: key
  endpoint: https://{your-custom-endpoint}.openai.azure.com/
options:
  type: chat
  temperature: 0.7
  maxTokens: 1000

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| id | string | The unique identifier of the model - can be used as the single property shorthand  |
| provider | string | The provider of the model (e.g., &#39;openai&#39;, &#39;azure&#39;, &#39;anthropic&#39;)  |
| connection | [Connection](Connection.md) | The connection configuration for the model  |
| options | [ModelOptions](ModelOptions.md) | Additional options for the model  |
