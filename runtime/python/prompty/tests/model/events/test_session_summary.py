import json

import yaml

from prompty.model import SessionSummary


def test_load_json_sessionsummary():
    json_data = r"""
    {
      "sessionId": "sess_abc123",
      "status": "success",
      "turns": 5,
      "checkpoints": 2,
      "durationMs": 12500
    }
    """
    data = json.loads(json_data, strict=False)
    instance = SessionSummary.load(data)
    assert instance is not None
    assert instance.session_id == "sess_abc123"
    assert instance.status == "success"
    assert instance.turns == 5
    assert instance.checkpoints == 2
    assert instance.duration_ms == 12500


def test_load_yaml_sessionsummary():
    yaml_data = r"""
    sessionId: sess_abc123
    status: success
    turns: 5
    checkpoints: 2
    durationMs: 12500

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = SessionSummary.load(data)
    assert instance is not None
    assert instance.session_id == "sess_abc123"
    assert instance.status == "success"
    assert instance.turns == 5
    assert instance.checkpoints == 2
    assert instance.duration_ms == 12500


def test_roundtrip_json_sessionsummary():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "sessionId": "sess_abc123",
      "status": "success",
      "turns": 5,
      "checkpoints": 2,
      "durationMs": 12500
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = SessionSummary.load(original_data)
    saved_data = instance.save()
    reloaded = SessionSummary.load(saved_data)
    assert reloaded is not None
    assert reloaded.session_id == "sess_abc123"
    assert reloaded.status == "success"
    assert reloaded.turns == 5
    assert reloaded.checkpoints == 2
    assert reloaded.duration_ms == 12500


def test_to_json_sessionsummary():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "sessionId": "sess_abc123",
      "status": "success",
      "turns": 5,
      "checkpoints": 2,
      "durationMs": 12500
    }
    """
    data = json.loads(json_data, strict=False)
    instance = SessionSummary.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_sessionsummary():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "sessionId": "sess_abc123",
      "status": "success",
      "turns": 5,
      "checkpoints": 2,
      "durationMs": 12500
    }
    """
    data = json.loads(json_data, strict=False)
    instance = SessionSummary.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
