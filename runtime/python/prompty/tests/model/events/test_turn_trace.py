import json

import yaml

from prompty.model import TurnTrace


def test_load_json_turntrace():
    json_data = r"""
    {
      "version": "1",
      "runtime": "typescript",
      "promptyVersion": "2.0.0"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TurnTrace.load(data)
    assert instance is not None
    assert instance.version == "1"
    assert instance.runtime == "typescript"
    assert instance.prompty_version == "2.0.0"


def test_load_yaml_turntrace():
    yaml_data = r"""
    version: "1"
    runtime: typescript
    promptyVersion: 2.0.0

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = TurnTrace.load(data)
    assert instance is not None
    assert instance.version == "1"
    assert instance.runtime == "typescript"
    assert instance.prompty_version == "2.0.0"


def test_roundtrip_json_turntrace():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "version": "1",
      "runtime": "typescript",
      "promptyVersion": "2.0.0"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = TurnTrace.load(original_data)
    saved_data = instance.save()
    reloaded = TurnTrace.load(saved_data)
    assert reloaded is not None
    assert reloaded.version == "1"
    assert reloaded.runtime == "typescript"
    assert reloaded.prompty_version == "2.0.0"


def test_to_json_turntrace():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "version": "1",
      "runtime": "typescript",
      "promptyVersion": "2.0.0"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TurnTrace.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_turntrace():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "version": "1",
      "runtime": "typescript",
      "promptyVersion": "2.0.0"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TurnTrace.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
