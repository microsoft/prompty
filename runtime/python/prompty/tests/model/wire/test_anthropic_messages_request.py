import json

import yaml

from prompty.model import AnthropicMessagesRequest


def test_load_json_anthropicmessagesrequest():
    json_data = r'''
    {
      "model": "claude-sonnet-4-20250514",
      "max_tokens": 4096,
      "system": "You are a helpful assistant.",
      "temperature": 0.7,
      "top_p": 0.9,
      "top_k": 40,
      "stop_sequences": [
        "\n\nHuman:"
      ]
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = AnthropicMessagesRequest.load(data)
    assert instance is not None
    assert instance.model == "claude-sonnet-4-20250514"
    assert instance.max_tokens == 4096
    assert instance.system == "You are a helpful assistant."
    assert instance.temperature == 0.7
    assert instance.top_p == 0.9
    assert instance.top_k == 40

def test_load_yaml_anthropicmessagesrequest():
    yaml_data = r'''
    model: claude-sonnet-4-20250514
    max_tokens: 4096
    system: You are a helpful assistant.
    temperature: 0.7
    top_p: 0.9
    top_k: 40
    stop_sequences:
      - "\n\nHuman:"
    
    '''
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = AnthropicMessagesRequest.load(data)
    assert instance is not None
    assert instance.model == "claude-sonnet-4-20250514"
    assert instance.max_tokens == 4096
    assert instance.system == "You are a helpful assistant."
    assert instance.temperature == 0.7
    assert instance.top_p == 0.9
    assert instance.top_k == 40

def test_roundtrip_json_anthropicmessagesrequest():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r'''
    {
      "model": "claude-sonnet-4-20250514",
      "max_tokens": 4096,
      "system": "You are a helpful assistant.",
      "temperature": 0.7,
      "top_p": 0.9,
      "top_k": 40,
      "stop_sequences": [
        "\n\nHuman:"
      ]
    }
    '''
    original_data = json.loads(json_data, strict=False)
    instance = AnthropicMessagesRequest.load(original_data)
    saved_data = instance.save()
    reloaded = AnthropicMessagesRequest.load(saved_data)
    assert reloaded is not None
    assert reloaded.model == "claude-sonnet-4-20250514"
    assert reloaded.max_tokens == 4096
    assert reloaded.system == "You are a helpful assistant."
    assert reloaded.temperature == 0.7
    assert reloaded.top_p == 0.9
    assert reloaded.top_k == 40

def test_to_json_anthropicmessagesrequest():
    """Test that to_json produces valid JSON."""
    json_data = r'''
    {
      "model": "claude-sonnet-4-20250514",
      "max_tokens": 4096,
      "system": "You are a helpful assistant.",
      "temperature": 0.7,
      "top_p": 0.9,
      "top_k": 40,
      "stop_sequences": [
        "\n\nHuman:"
      ]
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = AnthropicMessagesRequest.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)

def test_to_yaml_anthropicmessagesrequest():
    """Test that to_yaml produces valid YAML."""
    json_data = r'''
    {
      "model": "claude-sonnet-4-20250514",
      "max_tokens": 4096,
      "system": "You are a helpful assistant.",
      "temperature": 0.7,
      "top_p": 0.9,
      "top_k": 40,
      "stop_sequences": [
        "\n\nHuman:"
      ]
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = AnthropicMessagesRequest.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

