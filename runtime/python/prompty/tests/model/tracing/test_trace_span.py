import json

import yaml

from prompty.model import TraceSpan


def test_load_json_tracespan():
    json_data = r"""
    {
      "name": "prompty.core.pipeline.run",
      "signature": "prompty.core.pipeline.run",
      "error": "Connection refused"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TraceSpan.load(data)
    assert instance is not None
    assert instance.name == "prompty.core.pipeline.run"
    assert instance.signature == "prompty.core.pipeline.run"
    assert instance.error == "Connection refused"


def test_load_yaml_tracespan():
    yaml_data = r"""
    name: prompty.core.pipeline.run
    signature: prompty.core.pipeline.run
    error: Connection refused

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = TraceSpan.load(data)
    assert instance is not None
    assert instance.name == "prompty.core.pipeline.run"
    assert instance.signature == "prompty.core.pipeline.run"
    assert instance.error == "Connection refused"


def test_roundtrip_json_tracespan():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "name": "prompty.core.pipeline.run",
      "signature": "prompty.core.pipeline.run",
      "error": "Connection refused"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = TraceSpan.load(original_data)
    saved_data = instance.save()
    reloaded = TraceSpan.load(saved_data)
    assert reloaded is not None
    assert reloaded.name == "prompty.core.pipeline.run"
    assert reloaded.signature == "prompty.core.pipeline.run"
    assert reloaded.error == "Connection refused"


def test_to_json_tracespan():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "name": "prompty.core.pipeline.run",
      "signature": "prompty.core.pipeline.run",
      "error": "Connection refused"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TraceSpan.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_tracespan():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "name": "prompty.core.pipeline.run",
      "signature": "prompty.core.pipeline.run",
      "error": "Connection refused"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TraceSpan.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
