# ServerTool

Represents a generic server tool that runs on a server
This tool type is designed for operations that require server-side execution
It may include features such as authentication, data storage, and long-running processes
This tool type is ideal for tasks that involve complex computations or access to secure resources
Server tools can be used to offload heavy processing from client applications

## Class Diagram

```mermaid
---
title: ServerTool
---
classDiagram
    class ServerTool {
        +string type
        +dictionary options
    }
```






## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| type | string | The type identifier for server tools  |
| options | dictionary | Configuration options for the server tool  |



