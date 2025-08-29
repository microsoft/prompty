# Class Diagram

The following diagram illustrates the classes and their relationships for declarative agents.
The root [Prompty](Prompty.md) object represents the main entry point for the system.

```mermaid
---
title: Declarative Agents
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
    Options <|-- BingSearchOptions
    Options <|-- FileSearchOptions
    Options <|-- McpToolOptions
    Output <|-- ArrayOutput
    Output <|-- ObjectOutput
    Tool <|-- FunctionTool
    Tool <|-- ServerTool
    Tool <|-- BingSearchTool
    Tool <|-- FileSearchTool
    Tool <|-- McpTool
    Parameter <|-- ObjectParameter
    Parameter <|-- ArrayParameter
    BingSearchOptions *-- BingSearchConfiguration
    FileSearchOptions *-- FileSearchRankingOptions
    Authentication *-- Options
    McpToolOptions *-- Authentication
    Connection *-- Options
    Model *-- Connection
    ObjectOutput *-- Output
    ArrayOutput *-- Output
    Tool *-- Binding
    ArrayParameter *-- Parameter
    ObjectParameter *-- Parameter
    FunctionTool *-- Parameter
    ServerTool *-- Options
    BingSearchTool *-- BingSearchOptions
    FileSearchTool *-- FileSearchOptions
    McpTool *-- McpToolOptions
    Template *-- Options
    Prompty *-- Metadata
    Prompty *-- Model
    Prompty *-- Input
    Prompty *-- Output
    Prompty *-- Tool
    Prompty *-- Template
```