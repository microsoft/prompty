import json

import yaml

from prompty.model import PermissionRequestedPayload


def test_load_json_permissionrequestedpayload():
    json_data = r"""
    {
      "requestId": "perm_abc123",
      "toolCallId": "call_abc123",
      "permission": "tool.execute",
      "target": "shell",
      "promptRequest": "Allow shell to run tests?"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PermissionRequestedPayload.load(data)
    assert instance is not None
    assert instance.request_id == "perm_abc123"
    assert instance.tool_call_id == "call_abc123"
    assert instance.permission == "tool.execute"
    assert instance.target == "shell"
    assert instance.prompt_request == "Allow shell to run tests?"


def test_load_yaml_permissionrequestedpayload():
    yaml_data = r"""
    requestId: perm_abc123
    toolCallId: call_abc123
    permission: tool.execute
    target: shell
    promptRequest: Allow shell to run tests?

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = PermissionRequestedPayload.load(data)
    assert instance is not None
    assert instance.request_id == "perm_abc123"
    assert instance.tool_call_id == "call_abc123"
    assert instance.permission == "tool.execute"
    assert instance.target == "shell"
    assert instance.prompt_request == "Allow shell to run tests?"


def test_roundtrip_json_permissionrequestedpayload():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "requestId": "perm_abc123",
      "toolCallId": "call_abc123",
      "permission": "tool.execute",
      "target": "shell",
      "promptRequest": "Allow shell to run tests?"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = PermissionRequestedPayload.load(original_data)
    saved_data = instance.save()
    reloaded = PermissionRequestedPayload.load(saved_data)
    assert reloaded is not None
    assert reloaded.request_id == "perm_abc123"
    assert reloaded.tool_call_id == "call_abc123"
    assert reloaded.permission == "tool.execute"
    assert reloaded.target == "shell"
    assert reloaded.prompt_request == "Allow shell to run tests?"


def test_to_json_permissionrequestedpayload():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "requestId": "perm_abc123",
      "toolCallId": "call_abc123",
      "permission": "tool.execute",
      "target": "shell",
      "promptRequest": "Allow shell to run tests?"
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
      "requestId": "perm_abc123",
      "toolCallId": "call_abc123",
      "permission": "tool.execute",
      "target": "shell",
      "promptRequest": "Allow shell to run tests?"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PermissionRequestedPayload.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
