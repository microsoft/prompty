import json

import yaml

from prompty.model import HookEndPayload


def test_load_json_hookendpayload():
    json_data = r"""
    {
      "hookInvocationId": "hook_abc123",
      "hookType": "preToolUse",
      "success": true,
      "durationMs": 12,
      "error": "hook failed"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = HookEndPayload.load(data)
    assert instance is not None
    assert instance.hook_invocation_id == "hook_abc123"
    assert instance.hook_type == "preToolUse"
    assert instance.success
    assert instance.duration_ms == 12
    assert instance.error == "hook failed"


def test_load_yaml_hookendpayload():
    yaml_data = r"""
    hookInvocationId: hook_abc123
    hookType: preToolUse
    success: true
    durationMs: 12
    error: hook failed

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = HookEndPayload.load(data)
    assert instance is not None
    assert instance.hook_invocation_id == "hook_abc123"
    assert instance.hook_type == "preToolUse"
    assert instance.success
    assert instance.duration_ms == 12
    assert instance.error == "hook failed"


def test_roundtrip_json_hookendpayload():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "hookInvocationId": "hook_abc123",
      "hookType": "preToolUse",
      "success": true,
      "durationMs": 12,
      "error": "hook failed"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = HookEndPayload.load(original_data)
    saved_data = instance.save()
    reloaded = HookEndPayload.load(saved_data)
    assert reloaded is not None
    assert reloaded.hook_invocation_id == "hook_abc123"
    assert reloaded.hook_type == "preToolUse"
    assert reloaded.success
    assert reloaded.duration_ms == 12
    assert reloaded.error == "hook failed"


def test_to_json_hookendpayload():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "hookInvocationId": "hook_abc123",
      "hookType": "preToolUse",
      "success": true,
      "durationMs": 12,
      "error": "hook failed"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = HookEndPayload.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_hookendpayload():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "hookInvocationId": "hook_abc123",
      "hookType": "preToolUse",
      "success": true,
      "durationMs": 12,
      "error": "hook failed"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = HookEndPayload.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
