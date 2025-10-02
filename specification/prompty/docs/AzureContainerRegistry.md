# AzureContainerRegistry

Definition for an Azure Container Registry (ACR).

## Class Diagram

```mermaid
---
title: AzureContainerRegistry
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class Registry {
        +string kind
        +Connection connection
    }
    Registry <|-- AzureContainerRegistry
    class AzureContainerRegistry {
      
        +string kind
        +string subscription
        +string resourceGroup
        +string registryName
    }
```

## Yaml Example

```yaml
kind: acr
subscription: your-subscription-id
resourceGroup: your-resource-group
registryName: your-acr-name

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The kind of container registry  |
| subscription | string | The Azure subscription ID for the ACR  |
| resourceGroup | string | The Azure resource group containing the ACR  |
| registryName | string | The name of the ACR  |
