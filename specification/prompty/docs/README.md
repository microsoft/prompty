# Class Diagram

The following diagram illustrates the classes and their relationships for declarative agents.
The root [object](Prompty.md) represents the main entry point for the system.

```mermaid
---
title: Declarative Agents
---
classDiagram
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
    class ModelTool {
        +string kind
        +string id
        +string provider
        +Connection connection
        +ModelOptions options
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
        +Connection[] connections
        +Template template
        +string instructions
        +string additional_instructions
    }
    class Connection {
        +string kind
        +string authority
        +string usage_description
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
    class Registry {
        +string kind
        +Connection connection
    }
    class AzureContainerRegistry {
        +string kind
        +string subscription
        +string resource_group
        +string registry_name
    }
    class Scale {
        +numeric minReplicas
        +numeric maxReplicas
        +float cpu
        +float memory
    }
    class ContainerDefinition {
        +string image
        +string tag
        +Registry registry
        +Scale scale
    }
    class EnvironmentVariable {
        +string name
        +string value
    }
    class PromptyContainer {
        +string kind
        +ContainerDefinition container
        +EnvironmentVariable[] environment_variables
    }
    Input <|-- ArrayInput
    Input <|-- ObjectInput
    Output <|-- ArrayOutput
    Output <|-- ObjectOutput
    Tool <|-- FunctionTool
    Tool <|-- ServerTool
    Tool <|-- BingSearchTool
    Tool <|-- FileSearchTool
    Tool <|-- McpTool
    Tool <|-- ModelTool
    Parameter <|-- ObjectParameter
    Parameter <|-- ArrayParameter
    Prompty <|-- PromptyContainer
    Connection <|-- ReferenceConnection
    Connection <|-- KeyConnection
    Connection <|-- OAuthConnection
    Connection <|-- FoundryConnection
    Registry <|-- AzureContainerRegistry
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
    ModelTool *-- Connection
    ModelTool *-- ModelOptions
    Prompty *-- Model
    Prompty *-- Input
    Prompty *-- Output
    Prompty *-- Tool
    Prompty *-- Connection
    Prompty *-- Template
    Registry *-- Connection
    ContainerDefinition *-- Registry
    ContainerDefinition *-- Scale
    PromptyContainer *-- ContainerDefinition
    PromptyContainer *-- EnvironmentVariable
```
