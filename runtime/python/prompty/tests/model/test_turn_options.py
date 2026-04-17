import json

import yaml

from prompty.model import TurnOptions


def test_load_json_turnoptions():
    json_data = r"""
    {
      "maxIterations": 10,
      "maxLlmRetries": 3,
      "contextBudget": 100000,
      "parallelToolCalls": true,
      "raw": false,
      "turn": 1,
      "compaction": {
        "strategy": "summarize"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TurnOptions.load(data)
    assert instance is not None
    assert instance.max_iterations == 10
    assert instance.max_llm_retries == 3
    assert instance.context_budget == 100000
    assert instance.parallel_tool_calls
    assert not instance.raw
    assert instance.turn == 1


def test_load_yaml_turnoptions():
    yaml_data = r"""
    maxIterations: 10
    maxLlmRetries: 3
    contextBudget: 100000
    parallelToolCalls: true
    raw: false
    turn: 1
    compaction:
      strategy: summarize
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = TurnOptions.load(data)
    assert instance is not None
    assert instance.max_iterations == 10
    assert instance.max_llm_retries == 3
    assert instance.context_budget == 100000
    assert instance.parallel_tool_calls
    assert not instance.raw
    assert instance.turn == 1


def test_roundtrip_json_turnoptions():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "maxIterations": 10,
      "maxLlmRetries": 3,
      "contextBudget": 100000,
      "parallelToolCalls": true,
      "raw": false,
      "turn": 1,
      "compaction": {
        "strategy": "summarize"
      }
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = TurnOptions.load(original_data)
    saved_data = instance.save()
    reloaded = TurnOptions.load(saved_data)
    assert reloaded is not None
    assert reloaded.max_iterations == 10
    assert reloaded.max_llm_retries == 3
    assert reloaded.context_budget == 100000
    assert reloaded.parallel_tool_calls
    assert not reloaded.raw
    assert reloaded.turn == 1


def test_to_json_turnoptions():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "maxIterations": 10,
      "maxLlmRetries": 3,
      "contextBudget": 100000,
      "parallelToolCalls": true,
      "raw": false,
      "turn": 1,
      "compaction": {
        "strategy": "summarize"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TurnOptions.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_turnoptions():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "maxIterations": 10,
      "maxLlmRetries": 3,
      "contextBudget": 100000,
      "parallelToolCalls": true,
      "raw": false,
      "turn": 1,
      "compaction": {
        "strategy": "summarize"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TurnOptions.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
