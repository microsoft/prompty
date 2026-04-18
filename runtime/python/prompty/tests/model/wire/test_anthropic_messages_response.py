import json

import yaml

from prompty.model import AnthropicMessagesResponse


def test_load_json_anthropicmessagesresponse():
    json_data = r"""
    {
      "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
      "model": "claude-sonnet-4-20250514",
      "stop_reason": "end_turn"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = AnthropicMessagesResponse.load(data)
    assert instance is not None
    assert instance.id == "msg_01XFDUDYJgAACzvnptvVoYEL"
    assert instance.model == "claude-sonnet-4-20250514"
    assert instance.stop_reason == "end_turn"


def test_load_yaml_anthropicmessagesresponse():
    yaml_data = r"""
    id: msg_01XFDUDYJgAACzvnptvVoYEL
    model: claude-sonnet-4-20250514
    stop_reason: end_turn
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = AnthropicMessagesResponse.load(data)
    assert instance is not None
    assert instance.id == "msg_01XFDUDYJgAACzvnptvVoYEL"
    assert instance.model == "claude-sonnet-4-20250514"
    assert instance.stop_reason == "end_turn"


def test_roundtrip_json_anthropicmessagesresponse():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
      "model": "claude-sonnet-4-20250514",
      "stop_reason": "end_turn"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = AnthropicMessagesResponse.load(original_data)
    saved_data = instance.save()
    reloaded = AnthropicMessagesResponse.load(saved_data)
    assert reloaded is not None
    assert reloaded.id == "msg_01XFDUDYJgAACzvnptvVoYEL"
    assert reloaded.model == "claude-sonnet-4-20250514"
    assert reloaded.stop_reason == "end_turn"


def test_to_json_anthropicmessagesresponse():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
      "model": "claude-sonnet-4-20250514",
      "stop_reason": "end_turn"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = AnthropicMessagesResponse.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_anthropicmessagesresponse():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
      "model": "claude-sonnet-4-20250514",
      "stop_reason": "end_turn"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = AnthropicMessagesResponse.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
