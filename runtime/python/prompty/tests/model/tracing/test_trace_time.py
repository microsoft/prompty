import json

import yaml

from prompty.model import TraceTime


def test_load_json_tracetime():
    json_data = r"""
    {
      "start": "2026-04-04T12:00:00Z",
      "end": "2026-04-04T12:00:01Z",
      "duration": 1000
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TraceTime.load(data)
    assert instance is not None
    assert instance.start == "2026-04-04T12:00:00Z"
    assert instance.end == "2026-04-04T12:00:01Z"
    assert instance.duration == 1000


def test_load_yaml_tracetime():
    yaml_data = r"""
    start: "2026-04-04T12:00:00Z"
    end: "2026-04-04T12:00:01Z"
    duration: 1000

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = TraceTime.load(data)
    assert instance is not None
    assert instance.start == "2026-04-04T12:00:00Z"
    assert instance.end == "2026-04-04T12:00:01Z"
    assert instance.duration == 1000


def test_roundtrip_json_tracetime():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "start": "2026-04-04T12:00:00Z",
      "end": "2026-04-04T12:00:01Z",
      "duration": 1000
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = TraceTime.load(original_data)
    saved_data = instance.save()
    reloaded = TraceTime.load(saved_data)
    assert reloaded is not None
    assert reloaded.start == "2026-04-04T12:00:00Z"
    assert reloaded.end == "2026-04-04T12:00:01Z"
    assert reloaded.duration == 1000


def test_to_json_tracetime():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "start": "2026-04-04T12:00:00Z",
      "end": "2026-04-04T12:00:01Z",
      "duration": 1000
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TraceTime.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_tracetime():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "start": "2026-04-04T12:00:00Z",
      "end": "2026-04-04T12:00:01Z",
      "duration": 1000
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TraceTime.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
