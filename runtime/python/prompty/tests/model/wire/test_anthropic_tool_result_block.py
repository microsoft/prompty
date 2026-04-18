import json

import yaml

from prompty.model import AnthropicToolResultBlock


def test_load_json_anthropictoolresultblock():
    json_data = r"""
    {
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "72°F and sunny in Paris"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = AnthropicToolResultBlock.load(data)
    assert instance is not None
    assert instance.tool_use_id == "toolu_01A09q90qw90lq917835lq9"
    assert instance.content == "72°F and sunny in Paris"


def test_load_yaml_anthropictoolresultblock():
    yaml_data = r"""
    tool_use_id: toolu_01A09q90qw90lq917835lq9
    content: 72°F and sunny in Paris
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = AnthropicToolResultBlock.load(data)
    assert instance is not None
    assert instance.tool_use_id == "toolu_01A09q90qw90lq917835lq9"
    assert instance.content == "72°F and sunny in Paris"


def test_roundtrip_json_anthropictoolresultblock():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "72°F and sunny in Paris"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = AnthropicToolResultBlock.load(original_data)
    saved_data = instance.save()
    reloaded = AnthropicToolResultBlock.load(saved_data)
    assert reloaded is not None
    assert reloaded.tool_use_id == "toolu_01A09q90qw90lq917835lq9"
    assert reloaded.content == "72°F and sunny in Paris"


def test_to_json_anthropictoolresultblock():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "72°F and sunny in Paris"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = AnthropicToolResultBlock.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_anthropictoolresultblock():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "72°F and sunny in Paris"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = AnthropicToolResultBlock.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
