import json

import yaml

from prompty.model import HostToolRequest


def test_load_json_hosttoolrequest():
    json_data = r"""
    {
      "requestId": "exec_abc123",
      "toolCallId": "call_abc123",
      "toolName": "powershell",
      "workingDirectory": "/workspace/project"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = HostToolRequest.load(data)
    assert instance is not None
    assert instance.request_id == "exec_abc123"
    assert instance.tool_call_id == "call_abc123"
    assert instance.tool_name == "powershell"
    assert instance.working_directory == "/workspace/project"


def test_load_yaml_hosttoolrequest():
    yaml_data = r"""
    requestId: exec_abc123
    toolCallId: call_abc123
    toolName: powershell
    workingDirectory: /workspace/project

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = HostToolRequest.load(data)
    assert instance is not None
    assert instance.request_id == "exec_abc123"
    assert instance.tool_call_id == "call_abc123"
    assert instance.tool_name == "powershell"
    assert instance.working_directory == "/workspace/project"


def test_roundtrip_json_hosttoolrequest():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "requestId": "exec_abc123",
      "toolCallId": "call_abc123",
      "toolName": "powershell",
      "workingDirectory": "/workspace/project"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = HostToolRequest.load(original_data)
    saved_data = instance.save()
    reloaded = HostToolRequest.load(saved_data)
    assert reloaded is not None
    assert reloaded.request_id == "exec_abc123"
    assert reloaded.tool_call_id == "call_abc123"
    assert reloaded.tool_name == "powershell"
    assert reloaded.working_directory == "/workspace/project"


def test_to_json_hosttoolrequest():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "requestId": "exec_abc123",
      "toolCallId": "call_abc123",
      "toolName": "powershell",
      "workingDirectory": "/workspace/project"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = HostToolRequest.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_hosttoolrequest():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "requestId": "exec_abc123",
      "toolCallId": "call_abc123",
      "toolName": "powershell",
      "workingDirectory": "/workspace/project"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = HostToolRequest.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
