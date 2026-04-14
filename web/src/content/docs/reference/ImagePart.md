---
title: "ImagePart"
description: "Documentation for the ImagePart type."
slug: "reference/imagepart"
---

An image content part. The source may be a URL or base64-encoded data.

## Class Diagram

```mermaid
---
title: ImagePart
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class ContentPart {
        +string kind
    }
    ContentPart <|-- ImagePart
    class ImagePart {
      
        +string kind
        +string source
        +string detail
        +string mediaType
    }
```

## Yaml Example

```yaml
source: https://example.com/image.png
detail: auto
mediaType: image/png
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The kind identifier for image content |
| source | string | URL or base64-encoded image data |
| detail | string | Detail level hint for the model (e.g., &#39;auto&#39;, &#39;low&#39;, &#39;high&#39;) |
| mediaType | string | MIME type of the image (e.g., &#39;image/png&#39;) |
