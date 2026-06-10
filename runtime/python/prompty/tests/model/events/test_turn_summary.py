import json

import yaml

from prompty.model import TurnSummary


def test_load_json_turnsummary():
    json_data = r"""
    {
      "turnId": "turn_001",
      "status": "success",
      "iterations": 2,
      "llmCalls": 3,
      "toolCalls": 2,
      "retries": 1,
      "durationMs": 2500
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TurnSummary.load(data)
    assert instance is not None
    assert instance.turn_id == "turn_001"
    assert instance.status == "success"
    assert instance.iterations == 2
    assert instance.llm_calls == 3
    assert instance.tool_calls == 2
    assert instance.retries == 1
    assert instance.duration_ms == 2500


def test_load_yaml_turnsummary():
    yaml_data = r"""
    turnId: turn_001
    status: success
    iterations: 2
    llmCalls: 3
    toolCalls: 2
    retries: 1
    durationMs: 2500

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = TurnSummary.load(data)
    assert instance is not None
    assert instance.turn_id == "turn_001"
    assert instance.status == "success"
    assert instance.iterations == 2
    assert instance.llm_calls == 3
    assert instance.tool_calls == 2
    assert instance.retries == 1
    assert instance.duration_ms == 2500


def test_roundtrip_json_turnsummary():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "turnId": "turn_001",
      "status": "success",
      "iterations": 2,
      "llmCalls": 3,
      "toolCalls": 2,
      "retries": 1,
      "durationMs": 2500
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = TurnSummary.load(original_data)
    saved_data = instance.save()
    reloaded = TurnSummary.load(saved_data)
    assert reloaded is not None
    assert reloaded.turn_id == "turn_001"
    assert reloaded.status == "success"
    assert reloaded.iterations == 2
    assert reloaded.llm_calls == 3
    assert reloaded.tool_calls == 2
    assert reloaded.retries == 1
    assert reloaded.duration_ms == 2500


def test_to_json_turnsummary():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "turnId": "turn_001",
      "status": "success",
      "iterations": 2,
      "llmCalls": 3,
      "toolCalls": 2,
      "retries": 1,
      "durationMs": 2500
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TurnSummary.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_turnsummary():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "turnId": "turn_001",
      "status": "success",
      "iterations": 2,
      "llmCalls": 3,
      "toolCalls": 2,
      "retries": 1,
      "durationMs": 2500
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TurnSummary.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
