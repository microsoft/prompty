# Class Diagram

The following diagram illustrates the classes and their relationships for declarative agents.
The root [object](Prompty.md) represents the main entry point for the system.

```mermaid
---
title: Declarative Agents
---
classDiagram
    class Record&lt;unknown&gt; {
    }
    class Connection {
        +string provider
        +string type
        +string endpoint
        +dictionary options
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
        +FileSearchOptions options
    }
    class Authentication {
        +string type
        +dictionary credentials
    }
    class McpToolOptions {
        +string name
        +string url
        +string[] allowed
        +Authentication authentication
    }
    class McpTool {
        +string type
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
    ObjectOutput *-- Output
    ArrayOutput *-- Output
    Tool *-- Binding
    ArrayParameter *-- Parameter
    ObjectParameter *-- Parameter
    FunctionTool *-- Parameter
    BingSearchOptions *-- BingSearchConfiguration
    BingSearchTool *-- BingSearchOptions
    FileSearchOptions *-- FileSearchRankingOptions
    FileSearchTool *-- FileSearchOptions
    McpToolOptions *-- Authentication
    McpTool *-- McpToolOptions
    Prompty *-- Model
    Prompty *-- Input
    Prompty *-- Output
    Prompty *-- Tool
    Prompty *-- Template
```