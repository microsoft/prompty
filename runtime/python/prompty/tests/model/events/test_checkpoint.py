import json

import yaml

from prompty.model import Checkpoint


def test_load_json_checkpoint():
    json_data = r"""
    {
      "id": "chk_abc123",
      "sessionId": "sess_abc123",
      "turnId": "turn_001",
      "checkpointNumber": 3,
      "title": "Added harness contracts",
      "createdAt": "2026-06-09T20:00:00Z"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Checkpoint.load(data)
    assert instance is not None
    assert instance.id == "chk_abc123"
    assert instance.session_id == "sess_abc123"
    assert instance.turn_id == "turn_001"
    assert instance.checkpoint_number == 3
    assert instance.title == "Added harness contracts"
    assert instance.created_at == "2026-06-09T20:00:00Z"


def test_load_yaml_checkpoint():
    yaml_data = r"""
    id: chk_abc123
    sessionId: sess_abc123
    turnId: turn_001
    checkpointNumber: 3
    title: Added harness contracts
    createdAt: "2026-06-09T20:00:00Z"

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Checkpoint.load(data)
    assert instance is not None
    assert instance.id == "chk_abc123"
    assert instance.session_id == "sess_abc123"
    assert instance.turn_id == "turn_001"
    assert instance.checkpoint_number == 3
    assert instance.title == "Added harness contracts"
    assert instance.created_at == "2026-06-09T20:00:00Z"


def test_roundtrip_json_checkpoint():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "id": "chk_abc123",
      "sessionId": "sess_abc123",
      "turnId": "turn_001",
      "checkpointNumber": 3,
      "title": "Added harness contracts",
      "createdAt": "2026-06-09T20:00:00Z"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = Checkpoint.load(original_data)
    saved_data = instance.save()
    reloaded = Checkpoint.load(saved_data)
    assert reloaded is not None
    assert reloaded.id == "chk_abc123"
    assert reloaded.session_id == "sess_abc123"
    assert reloaded.turn_id == "turn_001"
    assert reloaded.checkpoint_number == 3
    assert reloaded.title == "Added harness contracts"
    assert reloaded.created_at == "2026-06-09T20:00:00Z"


def test_to_json_checkpoint():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "id": "chk_abc123",
      "sessionId": "sess_abc123",
      "turnId": "turn_001",
      "checkpointNumber": 3,
      "title": "Added harness contracts",
      "createdAt": "2026-06-09T20:00:00Z"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Checkpoint.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_checkpoint():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "id": "chk_abc123",
      "sessionId": "sess_abc123",
      "turnId": "turn_001",
      "checkpointNumber": 3,
      "title": "Added harness contracts",
      "createdAt": "2026-06-09T20:00:00Z"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Checkpoint.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
