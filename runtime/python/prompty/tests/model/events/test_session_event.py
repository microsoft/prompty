import json

import yaml

from prompty.model import SessionEvent


def test_load_json_sessionevent():
    json_data = r"""
    {
      "id": "evt_abc123",
      "timestamp": "2026-06-09T20:00:00Z",
      "sessionId": "sess_abc123",
      "turnId": "turn_001",
      "parentId": "evt_parent",
      "spanId": "span_hook_001"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = SessionEvent.load(data)
    assert instance is not None
    assert instance.id == "evt_abc123"
    assert instance.timestamp == "2026-06-09T20:00:00Z"
    assert instance.session_id == "sess_abc123"
    assert instance.turn_id == "turn_001"
    assert instance.parent_id == "evt_parent"
    assert instance.span_id == "span_hook_001"


def test_load_yaml_sessionevent():
    yaml_data = r"""
    id: evt_abc123
    timestamp: "2026-06-09T20:00:00Z"
    sessionId: sess_abc123
    turnId: turn_001
    parentId: evt_parent
    spanId: span_hook_001

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = SessionEvent.load(data)
    assert instance is not None
    assert instance.id == "evt_abc123"
    assert instance.timestamp == "2026-06-09T20:00:00Z"
    assert instance.session_id == "sess_abc123"
    assert instance.turn_id == "turn_001"
    assert instance.parent_id == "evt_parent"
    assert instance.span_id == "span_hook_001"


def test_roundtrip_json_sessionevent():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "id": "evt_abc123",
      "timestamp": "2026-06-09T20:00:00Z",
      "sessionId": "sess_abc123",
      "turnId": "turn_001",
      "parentId": "evt_parent",
      "spanId": "span_hook_001"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = SessionEvent.load(original_data)
    saved_data = instance.save()
    reloaded = SessionEvent.load(saved_data)
    assert reloaded is not None
    assert reloaded.id == "evt_abc123"
    assert reloaded.timestamp == "2026-06-09T20:00:00Z"
    assert reloaded.session_id == "sess_abc123"
    assert reloaded.turn_id == "turn_001"
    assert reloaded.parent_id == "evt_parent"
    assert reloaded.span_id == "span_hook_001"


def test_to_json_sessionevent():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "id": "evt_abc123",
      "timestamp": "2026-06-09T20:00:00Z",
      "sessionId": "sess_abc123",
      "turnId": "turn_001",
      "parentId": "evt_parent",
      "spanId": "span_hook_001"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = SessionEvent.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_sessionevent():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "id": "evt_abc123",
      "timestamp": "2026-06-09T20:00:00Z",
      "sessionId": "sess_abc123",
      "turnId": "turn_001",
      "parentId": "evt_parent",
      "spanId": "span_hook_001"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = SessionEvent.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
