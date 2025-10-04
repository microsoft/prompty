import json

import yaml

from prompty.core import PromptyManifest


def test_load_json_promptymanifest():
    json_data = """
    {
      "kind": "manifest",
      "template": {
        "format": "mustache",
        "parser": "prompty"
      },
      "instructions": "system:\nYou are an AI assistant who helps people find information.\nAs the assistant, you answer questions briefly, succinctly,\nand in a personable manner using markdown and even add some \npersonal flair with appropriate emojis.\n\n# Customer\nYou are helping {{firstName}} {{lastName}} to find answers to \ntheir questions. Use their name to address them in your responses.\nuser:\n{{question}}",
      "models": [
        {
          "id": "gpt-35-turbo"
        },
        {
          "id": "gpt-4o"
        },
        "custom-model-id"
      ],
      "parameters": {
        "param1": {
          "kind": "string"
        },
        "param2": {
          "kind": "number"
        }
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PromptyManifest.load(data)
    assert instance is not None
    assert instance.kind == "manifest"
    assert (
        instance.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )


def test_load_yaml_promptymanifest():
    yaml_data = """
    kind: manifest
    template:
      format: mustache
      parser: prompty
    instructions: |-
      system:
      You are an AI assistant who helps people find information.
      As the assistant, you answer questions briefly, succinctly,
      and in a personable manner using markdown and even add some 
      personal flair with appropriate emojis.
    
      # Customer
      You are helping {{firstName}} {{lastName}} to find answers to 
      their questions. Use their name to address them in your responses.
      user:
      {{question}}
    models:
      - id: gpt-35-turbo
      - id: gpt-4o
      - custom-model-id
    parameters:
      param1:
        kind: string
      param2:
        kind: number
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = PromptyManifest.load(data)
    assert instance is not None
    assert instance.kind == "manifest"
    assert (
        instance.instructions
        == """system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly,
and in a personable manner using markdown and even add some 
personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to 
their questions. Use their name to address them in your responses.
user:
{{question}}"""
    )
