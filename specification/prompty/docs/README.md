# Class Diagram

The following diagram illustrates the classes and their relationships for declarative agents.
The root [object](Prompty.md) represents the main entry point for the system.

```mermaid
---
title: Declarative Agents
---
classDiagram
    class Connection {
        +string authType
        +string endpoint
        +dictionary options
    }
    class ModelOptions {
        +string type
    }
    class Model {
        +string id
        +string provider
        +Connection connection
        +ModelOptions options
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
    class BingSearchOptions {
        +BingSearchConfiguration[] configurations
    }
    class BingSearchTool {
        +string type
        +Connection connection
        +BingSearchOptions options
    }
    class FileSearchRankingOptions {
        +string ranker
        +float32 scoreThreshold
    }
    class FileSearchOptions {
        +int32 maxNumResults
        +FileSearchRankingOptions rankingOptions
    }
    class FileSearchTool {
        +string type
        +Connection connection
        +FileSearchOptions options
    }
    class McpToolOptions {
        +string name
        +string url
        +string[] allowed
    }
    class McpTool {
        +string type
        +Connection connection
        +McpToolOptions options
    }
    class Template {
        +string format
        +string parser
        +boolean strict
        +dictionary options
    }
    class Prompty {
        +string type
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
    ObjectOutput *-- Output
    ArrayOutput *-- Output
    Tool *-- Binding
    ArrayParameter *-- Parameter
    ObjectParameter *-- Parameter
    FunctionTool *-- Parameter
    ServerTool *-- Connection
    BingSearchOptions *-- BingSearchConfiguration
    BingSearchTool *-- Connection
    BingSearchTool *-- BingSearchOptions
    FileSearchOptions *-- FileSearchRankingOptions
    FileSearchTool *-- Connection
    FileSearchTool *-- FileSearchOptions
    McpTool *-- Connection
    McpTool *-- McpToolOptions
    Prompty *-- Model
    Prompty *-- Input
    Prompty *-- Output
    Prompty *-- Tool
    Prompty *-- Template
```