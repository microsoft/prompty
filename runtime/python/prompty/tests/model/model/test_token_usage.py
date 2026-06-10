import json

import yaml

from prompty.model import TokenUsage


def test_load_json_tokenusage():
    json_data = r"""
    {
      "promptTokens": 150,
      "completionTokens": 42,
      "totalTokens": 192
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TokenUsage.load(data)
    assert instance is not None
    assert instance.prompt_tokens == 150
    assert instance.completion_tokens == 42
    assert instance.total_tokens == 192


def test_load_yaml_tokenusage():
    yaml_data = r"""
    promptTokens: 150
    completionTokens: 42
    totalTokens: 192

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = TokenUsage.load(data)
    assert instance is not None
    assert instance.prompt_tokens == 150
    assert instance.completion_tokens == 42
    assert instance.total_tokens == 192


def test_roundtrip_json_tokenusage():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "promptTokens": 150,
      "completionTokens": 42,
      "totalTokens": 192
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = TokenUsage.load(original_data)
    saved_data = instance.save()
    reloaded = TokenUsage.load(saved_data)
    assert reloaded is not None
    assert reloaded.prompt_tokens == 150
    assert reloaded.completion_tokens == 42
    assert reloaded.total_tokens == 192


def test_to_json_tokenusage():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "promptTokens": 150,
      "completionTokens": 42,
      "totalTokens": 192
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TokenUsage.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_tokenusage():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "promptTokens": 150,
      "completionTokens": 42,
      "totalTokens": 192
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TokenUsage.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
