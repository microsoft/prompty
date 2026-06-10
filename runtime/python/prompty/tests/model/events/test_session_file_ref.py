import json

import yaml

from prompty.model import SessionFileRef


def test_load_json_sessionfileref():
    json_data = r"""
    {
      "sessionId": "sess_abc123",
      "path": "src/index.ts",
      "toolName": "view",
      "turnIndex": 2,
      "firstSeenAt": "2026-06-09T20:00:00Z"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = SessionFileRef.load(data)
    assert instance is not None
    assert instance.session_id == "sess_abc123"
    assert instance.path == "src/index.ts"
    assert instance.tool_name == "view"
    assert instance.turn_index == 2
    assert instance.first_seen_at == "2026-06-09T20:00:00Z"


def test_load_yaml_sessionfileref():
    yaml_data = r"""
    sessionId: sess_abc123
    path: src/index.ts
    toolName: view
    turnIndex: 2
    firstSeenAt: "2026-06-09T20:00:00Z"

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = SessionFileRef.load(data)
    assert instance is not None
    assert instance.session_id == "sess_abc123"
    assert instance.path == "src/index.ts"
    assert instance.tool_name == "view"
    assert instance.turn_index == 2
    assert instance.first_seen_at == "2026-06-09T20:00:00Z"


def test_roundtrip_json_sessionfileref():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "sessionId": "sess_abc123",
      "path": "src/index.ts",
      "toolName": "view",
      "turnIndex": 2,
      "firstSeenAt": "2026-06-09T20:00:00Z"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = SessionFileRef.load(original_data)
    saved_data = instance.save()
    reloaded = SessionFileRef.load(saved_data)
    assert reloaded is not None
    assert reloaded.session_id == "sess_abc123"
    assert reloaded.path == "src/index.ts"
    assert reloaded.tool_name == "view"
    assert reloaded.turn_index == 2
    assert reloaded.first_seen_at == "2026-06-09T20:00:00Z"


def test_to_json_sessionfileref():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "sessionId": "sess_abc123",
      "path": "src/index.ts",
      "toolName": "view",
      "turnIndex": 2,
      "firstSeenAt": "2026-06-09T20:00:00Z"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = SessionFileRef.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_sessionfileref():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "sessionId": "sess_abc123",
      "path": "src/index.ts",
      "toolName": "view",
      "turnIndex": 2,
      "firstSeenAt": "2026-06-09T20:00:00Z"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = SessionFileRef.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
