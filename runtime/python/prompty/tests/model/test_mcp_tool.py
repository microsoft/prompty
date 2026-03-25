import json

import yaml

from prompty.model import McpTool


def test_load_json_mcptool():
    json_data = r"""
    {
      "kind": "mcp",
      "connection": {
        "kind": "reference"
      },
      "serverName": "My MCP Server",
      "serverDescription": "This tool allows access to MCP services.",
      "approvalMode": {
        "kind": "always"
      },
      "allowedTools": [
        "operation1",
        "operation2"
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = McpTool.load(data)
    assert instance is not None
    assert instance.kind == "mcp"
    assert instance.serverName == "My MCP Server"
    assert instance.serverDescription == "This tool allows access to MCP services."


def test_load_yaml_mcptool():
    yaml_data = r"""
    kind: mcp
    connection:
      kind: reference
    serverName: My MCP Server
    serverDescription: This tool allows access to MCP services.
    approvalMode:
      kind: always
    allowedTools:
      - operation1
      - operation2
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = McpTool.load(data)
    assert instance is not None
    assert instance.kind == "mcp"
    assert instance.serverName == "My MCP Server"
    assert instance.serverDescription == "This tool allows access to MCP services."


def test_roundtrip_json_mcptool():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "kind": "mcp",
      "connection": {
        "kind": "reference"
      },
      "serverName": "My MCP Server",
      "serverDescription": "This tool allows access to MCP services.",
      "approvalMode": {
        "kind": "always"
      },
      "allowedTools": [
        "operation1",
        "operation2"
      ]
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = McpTool.load(original_data)
    saved_data = instance.save()
    reloaded = McpTool.load(saved_data)
    assert reloaded is not None
    assert reloaded.kind == "mcp"
    assert reloaded.serverName == "My MCP Server"
    assert reloaded.serverDescription == "This tool allows access to MCP services."


def test_to_json_mcptool():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "kind": "mcp",
      "connection": {
        "kind": "reference"
      },
      "serverName": "My MCP Server",
      "serverDescription": "This tool allows access to MCP services.",
      "approvalMode": {
        "kind": "always"
      },
      "allowedTools": [
        "operation1",
        "operation2"
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = McpTool.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_mcptool():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "kind": "mcp",
      "connection": {
        "kind": "reference"
      },
      "serverName": "My MCP Server",
      "serverDescription": "This tool allows access to MCP services.",
      "approvalMode": {
        "kind": "always"
      },
      "allowedTools": [
        "operation1",
        "operation2"
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = McpTool.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
