# Authentication



## Class Diagram

```mermaid
---
title: Authentication
---
classDiagram
    class Options {
    }
    class Authentication {
        +string type
        +Options credentials
    }
    Authentication *-- Options
```





## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| type | string | The type of authentication to use  |
| credentials | [Options](Options.md) | The credentials to use for authentication  |


