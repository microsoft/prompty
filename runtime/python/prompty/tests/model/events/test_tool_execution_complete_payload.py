import json

import yaml

from prompty.model import ToolExecutionCompletePayload


def test_load_json_toolexecutioncompletepayload():
    json_data = r"""
    {
      "requestId": "exec_abc123",
      "toolCallId": "call_abc123",
      "toolName": "powershell",
      "success": true,
      "exitCode": 0,
      "durationMs": 250,
      "errorKind": "timeout"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ToolExecutionCompletePayload.load(data)
    assert instance is not None
    assert instance.request_id == "exec_abc123"
    assert instance.tool_call_id == "call_abc123"
    assert instance.tool_name == "powershell"
    assert instance.success
    assert instance.exit_code == 0
    assert instance.duration_ms == 250
    assert instance.error_kind == "timeout"


def test_load_yaml_toolexecutioncompletepayload():
    yaml_data = r"""
    requestId: exec_abc123
    toolCallId: call_abc123
    toolName: powershell
    success: true
    exitCode: 0
    durationMs: 250
    errorKind: timeout

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ToolExecutionCompletePayload.load(data)
    assert instance is not None
    assert instance.request_id == "exec_abc123"
    assert instance.tool_call_id == "call_abc123"
    assert instance.tool_name == "powershell"
    assert instance.success
    assert instance.exit_code == 0
    assert instance.duration_ms == 250
    assert instance.error_kind == "timeout"


def test_roundtrip_json_toolexecutioncompletepayload():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "requestId": "exec_abc123",
      "toolCallId": "call_abc123",
      "toolName": "powershell",
      "success": true,
      "exitCode": 0,
      "durationMs": 250,
      "errorKind": "timeout"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = ToolExecutionCompletePayload.load(original_data)
    saved_data = instance.save()
    reloaded = ToolExecutionCompletePayload.load(saved_data)
    assert reloaded is not None
    assert reloaded.request_id == "exec_abc123"
    assert reloaded.tool_call_id == "call_abc123"
    assert reloaded.tool_name == "powershell"
    assert reloaded.success
    assert reloaded.exit_code == 0
    assert reloaded.duration_ms == 250
    assert reloaded.error_kind == "timeout"


def test_to_json_toolexecutioncompletepayload():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "requestId": "exec_abc123",
      "toolCallId": "call_abc123",
      "toolName": "powershell",
      "success": true,
      "exitCode": 0,
      "durationMs": 250,
      "errorKind": "timeout"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ToolExecutionCompletePayload.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_toolexecutioncompletepayload():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "requestId": "exec_abc123",
      "toolCallId": "call_abc123",
      "toolName": "powershell",
      "success": true,
      "exitCode": 0,
      "durationMs": 250,
      "errorKind": "timeout"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ToolExecutionCompletePayload.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
