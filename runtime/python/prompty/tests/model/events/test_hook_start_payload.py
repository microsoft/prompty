import json

import yaml

from prompty.model import HookStartPayload


def test_load_json_hookstartpayload():
    json_data = r"""
    {
      "hookInvocationId": "hook_abc123",
      "hookType": "preToolUse"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = HookStartPayload.load(data)
    assert instance is not None
    assert instance.hook_invocation_id == "hook_abc123"
    assert instance.hook_type == "preToolUse"


def test_load_yaml_hookstartpayload():
    yaml_data = r"""
    hookInvocationId: hook_abc123
    hookType: preToolUse

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = HookStartPayload.load(data)
    assert instance is not None
    assert instance.hook_invocation_id == "hook_abc123"
    assert instance.hook_type == "preToolUse"


def test_roundtrip_json_hookstartpayload():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "hookInvocationId": "hook_abc123",
      "hookType": "preToolUse"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = HookStartPayload.load(original_data)
    saved_data = instance.save()
    reloaded = HookStartPayload.load(saved_data)
    assert reloaded is not None
    assert reloaded.hook_invocation_id == "hook_abc123"
    assert reloaded.hook_type == "preToolUse"


def test_to_json_hookstartpayload():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "hookInvocationId": "hook_abc123",
      "hookType": "preToolUse"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = HookStartPayload.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_hookstartpayload():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "hookInvocationId": "hook_abc123",
      "hookType": "preToolUse"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = HookStartPayload.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
