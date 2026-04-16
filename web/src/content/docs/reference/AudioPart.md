---
title: "AudioPart"
description: "Documentation for the AudioPart type."
slug: "reference/audiopart"
---

An audio content part. The source may be a URL or base64-encoded data.

## Class Diagram

```mermaid
---
title: AudioPart
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
    ContentPart <|-- AudioPart
    class AudioPart {
        +string kind
        +string source
        +string mediaType
    }
```

## Yaml Example

```yaml
source: https://example.com/audio.wav
mediaType: audio/wav
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The kind identifier for audio content |
| source | string | URL or base64-encoded audio data |
| mediaType | string | MIME type of the audio (e.g., 'audio/wav') |
