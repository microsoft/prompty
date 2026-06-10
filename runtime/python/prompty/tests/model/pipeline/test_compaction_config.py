import json

import yaml

from prompty.model import CompactionConfig


def test_load_json_compactionconfig():
    json_data = r"""
    {
      "strategy": "summarize",
      "budget": 50000,
      "options": {
        "preserveSystemMessages": true
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = CompactionConfig.load(data)
    assert instance is not None
    assert instance.strategy == "summarize"
    assert instance.budget == 50000


def test_load_yaml_compactionconfig():
    yaml_data = r"""
    strategy: summarize
    budget: 50000
    options:
      preserveSystemMessages: true

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = CompactionConfig.load(data)
    assert instance is not None
    assert instance.strategy == "summarize"
    assert instance.budget == 50000


def test_roundtrip_json_compactionconfig():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "strategy": "summarize",
      "budget": 50000,
      "options": {
        "preserveSystemMessages": true
      }
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = CompactionConfig.load(original_data)
    saved_data = instance.save()
    reloaded = CompactionConfig.load(saved_data)
    assert reloaded is not None
    assert reloaded.strategy == "summarize"
    assert reloaded.budget == 50000


def test_to_json_compactionconfig():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "strategy": "summarize",
      "budget": 50000,
      "options": {
        "preserveSystemMessages": true
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = CompactionConfig.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_compactionconfig():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "strategy": "summarize",
      "budget": 50000,
      "options": {
        "preserveSystemMessages": true
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = CompactionConfig.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
