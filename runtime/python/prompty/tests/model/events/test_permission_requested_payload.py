import json

import yaml

from prompty.model import PermissionRequestedPayload


def test_load_json_permissionrequestedpayload():
    json_data = r"""
    {
      "permission": "tool.execute",
      "target": "shell"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PermissionRequestedPayload.load(data)
    assert instance is not None
    assert instance.permission == "tool.execute"
    assert instance.target == "shell"


def test_load_yaml_permissionrequestedpayload():
    yaml_data = r"""
    permission: tool.execute
    target: shell

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = PermissionRequestedPayload.load(data)
    assert instance is not None
    assert instance.permission == "tool.execute"
    assert instance.target == "shell"


def test_roundtrip_json_permissionrequestedpayload():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "permission": "tool.execute",
      "target": "shell"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = PermissionRequestedPayload.load(original_data)
    saved_data = instance.save()
    reloaded = PermissionRequestedPayload.load(saved_data)
    assert reloaded is not None
    assert reloaded.permission == "tool.execute"
    assert reloaded.target == "shell"


def test_to_json_permissionrequestedpayload():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "permission": "tool.execute",
      "target": "shell"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PermissionRequestedPayload.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_permissionrequestedpayload():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "permission": "tool.execute",
      "target": "shell"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PermissionRequestedPayload.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
