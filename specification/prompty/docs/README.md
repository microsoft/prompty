# Class Diagram

The following diagram illustrates the classes and their relationships for declarative agents.
The root [object](Prompty.md) represents the main entry point for the system.

```mermaid
---
title: Prompty and Related Types
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class Connection {
      <<abstract>>
        +string kind
        +string authority
        +string usageDescription
    }
    class GenericConnection {
      
        +string kind
        +dictionary options
    }
    class ReferenceConnection {
      
        +string kind
        +string name
    }
    class KeyConnection {
      
        +string kind
        +string endpoint
        +string key
    }
    class OAuthConnection {
      
        +string kind
        +string endpoint
        +string clientId
        +string clientSecret
        +string tokenUrl
        +string[] scopes
    }
    class FoundryConnection {
      
        +string kind
        +string type
        +string name
        +string project
    }
    class ModelOptions {
      
        +string kind
    }
    class Model {
      
        +string id
        +string publisher
        +Connection connection
        +ModelOptions options
    }
    class Prompty {
      
        +string kind
        +Model model
    }
    Connection <|-- GenericConnection
    Connection <|-- ReferenceConnection
    Connection <|-- KeyConnection
    Connection <|-- OAuthConnection
    Connection <|-- FoundryConnection
    Model *-- Connection
    Model *-- ModelOptions
    Prompty *-- Model
```
