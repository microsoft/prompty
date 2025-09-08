# Class Diagram

The following diagram illustrates the classes and their relationships for declarative agents.
The root [object](Prompty.md) represents the main entry point for the system.

```mermaid
---
title: Declarative Agents
---
classDiagram
    class Connection {
        +string kind
        +string authority
        +string usage_description
        +dictionary options
    }
    class NamedConnection {
        +string kind
        +string name
        +dictionary options
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
    class ModelOptions {
        +string kind
    }
    class Model {
        +string id
        +string provider
        +Connection connection
        +ModelOptions options
    }
    class Input {
        +string name
        +string kind
        +string description
        +boolean required
        +boolean strict
        +unknown default
        +unknown sample
    }
    class ObjectInput {
        +string kind
        +Input[] properties
    }
    class ArrayInput {
        +string kind
        +Input items
    }
    class Output {
        +string name
        +string kind
        +string description
        +boolean required
    }
    class ObjectOutput {
        +string kind
        +Output[] properties
    }
    class ArrayOutput {
        +string kind
        +Output items
    }
    class Binding {
        +string name
        +string input
    }
    class Tool {
        +string name
        +string kind
        +string description
        +Binding[] bindings
    }
    class Parameter {
        +string name
        +string kind
        +string description
        +boolean required
        +unknown[] enum
    }
    class ArrayParameter {
        +string kind
        +Parameter items
    }
    class ObjectParameter {
        +string kind
        +Parameter[] properties
    }
    class FunctionTool {
        +string kind
        +Parameter[] parameters
    }
    class ServerTool {
        +string kind
        +Connection connection
        +dictionary options
    }
    class BingSearchConfiguration {
        +string connectionId
        +string instanceName
        +string market
        +string setLang
        +int64 count
        +string freshness
    }
    class BingSearchTool {
        +string kind
        +Connection connection
        +BingSearchConfiguration[] configurations
    }
    class FileSearchTool {
        +string kind
        +Connection connection
        +int32 maxNumResults
        +string ranker
        +float32 scoreThreshold
    }
    class McpTool {
        +string kind
        +Connection connection
        +string name
        +string url
        +string[] allowed
    }
    class Template {
        +string format
        +string parser
        +boolean strict
        +dictionary options
    }
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
    Connection <|-- NamedConnection
    Connection <|-- KeyConnection
    Connection <|-- OAuthConnection
    Input <|-- ArrayInput
    Input <|-- ObjectInput
    Output <|-- ArrayOutput
    Output <|-- ObjectOutput
    Tool <|-- FunctionTool
    Tool <|-- ServerTool
    Tool <|-- BingSearchTool
    Tool <|-- FileSearchTool
    Tool <|-- McpTool
    Parameter <|-- ObjectParameter
    Parameter <|-- ArrayParameter
    Model *-- Connection
    Model *-- ModelOptions
    ObjectInput *-- Input
    ArrayInput *-- Input
    ObjectOutput *-- Output
    ArrayOutput *-- Output
    Tool *-- Binding
    ArrayParameter *-- Parameter
    ObjectParameter *-- Parameter
    FunctionTool *-- Parameter
    ServerTool *-- Connection
    BingSearchTool *-- Connection
    BingSearchTool *-- BingSearchConfiguration
    FileSearchTool *-- Connection
    McpTool *-- Connection
    Prompty *-- Model
    Prompty *-- Input
    Prompty *-- Output
    Prompty *-- Tool
    Prompty *-- Template
```