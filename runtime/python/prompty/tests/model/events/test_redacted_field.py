import json

import yaml

from prompty.model import RedactedField


def test_load_json_redactedfield():
    json_data = r"""
    {
      "path": "$.arguments.apiKey",
      "mode": "redacted",
      "reason": "secret"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = RedactedField.load(data)
    assert instance is not None
    assert instance.path == "$.arguments.apiKey"
    assert instance.mode == "redacted"
    assert instance.reason == "secret"


def test_load_yaml_redactedfield():
    yaml_data = r"""
    path: $.arguments.apiKey
    mode: redacted
    reason: secret

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = RedactedField.load(data)
    assert instance is not None
    assert instance.path == "$.arguments.apiKey"
    assert instance.mode == "redacted"
    assert instance.reason == "secret"


def test_roundtrip_json_redactedfield():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "path": "$.arguments.apiKey",
      "mode": "redacted",
      "reason": "secret"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = RedactedField.load(original_data)
    saved_data = instance.save()
    reloaded = RedactedField.load(saved_data)
    assert reloaded is not None
    assert reloaded.path == "$.arguments.apiKey"
    assert reloaded.mode == "redacted"
    assert reloaded.reason == "secret"


def test_to_json_redactedfield():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "path": "$.arguments.apiKey",
      "mode": "redacted",
      "reason": "secret"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = RedactedField.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_redactedfield():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "path": "$.arguments.apiKey",
      "mode": "redacted",
      "reason": "secret"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = RedactedField.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
