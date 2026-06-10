import json

import yaml

from prompty.model import PermissionCompletedPayload


def test_load_json_permissioncompletedpayload():
    json_data = r"""
    {
      "permission": "tool.execute",
      "approved": true,
      "reason": "user_approved"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PermissionCompletedPayload.load(data)
    assert instance is not None
    assert instance.permission == "tool.execute"
    assert instance.approved
    assert instance.reason == "user_approved"


def test_load_yaml_permissioncompletedpayload():
    yaml_data = r"""
    permission: tool.execute
    approved: true
    reason: user_approved

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = PermissionCompletedPayload.load(data)
    assert instance is not None
    assert instance.permission == "tool.execute"
    assert instance.approved
    assert instance.reason == "user_approved"


def test_roundtrip_json_permissioncompletedpayload():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "permission": "tool.execute",
      "approved": true,
      "reason": "user_approved"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = PermissionCompletedPayload.load(original_data)
    saved_data = instance.save()
    reloaded = PermissionCompletedPayload.load(saved_data)
    assert reloaded is not None
    assert reloaded.permission == "tool.execute"
    assert reloaded.approved
    assert reloaded.reason == "user_approved"


def test_to_json_permissioncompletedpayload():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "permission": "tool.execute",
      "approved": true,
      "reason": "user_approved"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PermissionCompletedPayload.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_permissioncompletedpayload():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "permission": "tool.execute",
      "approved": true,
      "reason": "user_approved"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PermissionCompletedPayload.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
