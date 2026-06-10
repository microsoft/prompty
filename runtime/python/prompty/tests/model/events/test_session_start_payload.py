import json

import yaml

from prompty.model import SessionStartPayload


def test_load_json_sessionstartpayload():
    json_data = r"""
    {
      "sessionId": "sess_abc123",
      "schemaVersion": "1",
      "producer": "prompty-agent",
      "runtime": "typescript",
      "promptyVersion": "2.0.0",
      "startTime": "2026-06-09T20:00:00Z",
      "selectedModel": "gpt-4o-mini",
      "reasoningEffort": "medium"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = SessionStartPayload.load(data)
    assert instance is not None
    assert instance.session_id == "sess_abc123"
    assert instance.schema_version == "1"
    assert instance.producer == "prompty-agent"
    assert instance.runtime == "typescript"
    assert instance.prompty_version == "2.0.0"
    assert instance.start_time == "2026-06-09T20:00:00Z"
    assert instance.selected_model == "gpt-4o-mini"
    assert instance.reasoning_effort == "medium"


def test_load_yaml_sessionstartpayload():
    yaml_data = r"""
    sessionId: sess_abc123
    schemaVersion: "1"
    producer: prompty-agent
    runtime: typescript
    promptyVersion: 2.0.0
    startTime: "2026-06-09T20:00:00Z"
    selectedModel: gpt-4o-mini
    reasoningEffort: medium

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = SessionStartPayload.load(data)
    assert instance is not None
    assert instance.session_id == "sess_abc123"
    assert instance.schema_version == "1"
    assert instance.producer == "prompty-agent"
    assert instance.runtime == "typescript"
    assert instance.prompty_version == "2.0.0"
    assert instance.start_time == "2026-06-09T20:00:00Z"
    assert instance.selected_model == "gpt-4o-mini"
    assert instance.reasoning_effort == "medium"


def test_roundtrip_json_sessionstartpayload():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "sessionId": "sess_abc123",
      "schemaVersion": "1",
      "producer": "prompty-agent",
      "runtime": "typescript",
      "promptyVersion": "2.0.0",
      "startTime": "2026-06-09T20:00:00Z",
      "selectedModel": "gpt-4o-mini",
      "reasoningEffort": "medium"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = SessionStartPayload.load(original_data)
    saved_data = instance.save()
    reloaded = SessionStartPayload.load(saved_data)
    assert reloaded is not None
    assert reloaded.session_id == "sess_abc123"
    assert reloaded.schema_version == "1"
    assert reloaded.producer == "prompty-agent"
    assert reloaded.runtime == "typescript"
    assert reloaded.prompty_version == "2.0.0"
    assert reloaded.start_time == "2026-06-09T20:00:00Z"
    assert reloaded.selected_model == "gpt-4o-mini"
    assert reloaded.reasoning_effort == "medium"


def test_to_json_sessionstartpayload():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "sessionId": "sess_abc123",
      "schemaVersion": "1",
      "producer": "prompty-agent",
      "runtime": "typescript",
      "promptyVersion": "2.0.0",
      "startTime": "2026-06-09T20:00:00Z",
      "selectedModel": "gpt-4o-mini",
      "reasoningEffort": "medium"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = SessionStartPayload.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_sessionstartpayload():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "sessionId": "sess_abc123",
      "schemaVersion": "1",
      "producer": "prompty-agent",
      "runtime": "typescript",
      "promptyVersion": "2.0.0",
      "startTime": "2026-06-09T20:00:00Z",
      "selectedModel": "gpt-4o-mini",
      "reasoningEffort": "medium"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = SessionStartPayload.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
