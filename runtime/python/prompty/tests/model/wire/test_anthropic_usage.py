import json

import yaml

from prompty.model import AnthropicUsage


def test_load_json_anthropicusage():
    json_data = r"""
    {
      "input_tokens": 150,
      "output_tokens": 42
    }
    """
    data = json.loads(json_data, strict=False)
    instance = AnthropicUsage.load(data)
    assert instance is not None
    assert instance.input_tokens == 150
    assert instance.output_tokens == 42


def test_load_yaml_anthropicusage():
    yaml_data = r"""
    input_tokens: 150
    output_tokens: 42

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = AnthropicUsage.load(data)
    assert instance is not None
    assert instance.input_tokens == 150
    assert instance.output_tokens == 42


def test_roundtrip_json_anthropicusage():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "input_tokens": 150,
      "output_tokens": 42
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = AnthropicUsage.load(original_data)
    saved_data = instance.save()
    reloaded = AnthropicUsage.load(saved_data)
    assert reloaded is not None
    assert reloaded.input_tokens == 150
    assert reloaded.output_tokens == 42


def test_to_json_anthropicusage():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "input_tokens": 150,
      "output_tokens": 42
    }
    """
    data = json.loads(json_data, strict=False)
    instance = AnthropicUsage.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_anthropicusage():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "input_tokens": 150,
      "output_tokens": 42
    }
    """
    data = json.loads(json_data, strict=False)
    instance = AnthropicUsage.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
