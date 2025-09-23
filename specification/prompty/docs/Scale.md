# Scale

Configuration for scaling container instances.

## Class Diagram

```mermaid
---
title: Scale
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class Scale {
      
        +int32 minReplicas
        +int32 maxReplicas
        +float32 cpu
        +float32 memory
    }
```

## Yaml Example

```yaml
minReplicas: 1
maxReplicas: 5
cpu: 0.5
memory: 2

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| minReplicas | int32 | Minimum number of container instances to run  |
| maxReplicas | int32 | Maximum number of container instances to run  |
| cpu | float32 | CPU allocation per instance (in cores)  |
| memory | float32 | Memory allocation per instance (in GB)  |
