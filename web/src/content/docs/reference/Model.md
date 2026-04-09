---
title: "Model"
description: "Documentation for the Model type."
slug: "reference/model"
---

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
        +string apiType
        +Connection connection
        +ModelOptions options
    }
    class Connection {
        +string kind
        +string authenticationMode
        +string usageDescription
    }
    Model *-- Connection
    class ModelOptions {
        +float32 frequencyPenalty
        +int32 maxOutputTokens
        +float32 presencePenalty
        +int32 seed
        +float32 temperature
        +int32 topK
        +float32 topP
        +string[] stopSequences
        +boolean allowMultipleToolCalls
        +dictionary additionalProperties
    }
    Model *-- ModelOptions
```

## Yaml Example

```yaml
id: gpt-35-turbo
provider: foundry
apiType: chat
connection:
  kind: key
  endpoint: https://{your-custom-endpoint}.openai.azure.com/
  key: "{your-api-key}"
options:
  type: chat
  temperature: 0.7
  maxOutputTokens: 1000
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| id | string | The unique identifier of the model - can be used as the single property shorthand |
| provider | string | The provider of the model (e.g., &#39;openai&#39;, &#39;foundry&#39;, &#39;anthropic&#39;) |
| apiType | string | The type of API to use for the model (e.g., &#39;chat&#39;, &#39;response&#39;, etc.) |
| connection | [Connection](../connection/) | The connection configuration for the model(Related Types: [ReferenceConnection](../referenceconnection/), [RemoteConnection](../remoteconnection/), [ApiKeyConnection](../apikeyconnection/), [AnonymousConnection](../anonymousconnection/), [FoundryConnection](../foundryconnection/), [OAuthConnection](../oauthconnection/)) |
| options | [ModelOptions](../modeloptions/) | Additional options for the model |

## Composed Types

The following types are composed within `Model`:

- [Connection](../connection/)
- [ModelOptions](../modeloptions/)

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
