import json

import yaml

from prompty.model import McpApprovalMode


def test_load_json_mcpapprovalmode():
    json_data = r"""
    {
      "kind": "never",
      "alwaysRequireApprovalTools": [
        "operation1"
      ],
      "neverRequireApprovalTools": [
        "operation2"
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = McpApprovalMode.load(data)
    assert instance is not None
    assert instance.kind == "never"


def test_load_yaml_mcpapprovalmode():
    yaml_data = r"""
    kind: never
    alwaysRequireApprovalTools:
      - operation1
    neverRequireApprovalTools:
      - operation2
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = McpApprovalMode.load(data)
    assert instance is not None
    assert instance.kind == "never"


def test_roundtrip_json_mcpapprovalmode():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "kind": "never",
      "alwaysRequireApprovalTools": [
        "operation1"
      ],
      "neverRequireApprovalTools": [
        "operation2"
      ]
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = McpApprovalMode.load(original_data)
    saved_data = instance.save()
    reloaded = McpApprovalMode.load(saved_data)
    assert reloaded is not None
    assert reloaded.kind == "never"


def test_to_json_mcpapprovalmode():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "kind": "never",
      "alwaysRequireApprovalTools": [
        "operation1"
      ],
      "neverRequireApprovalTools": [
        "operation2"
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = McpApprovalMode.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_mcpapprovalmode():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "kind": "never",
      "alwaysRequireApprovalTools": [
        "operation1"
      ],
      "neverRequireApprovalTools": [
        "operation2"
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = McpApprovalMode.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)


def test_load_mcpapprovalmode_from_str():
    instance = McpApprovalMode.load("never")
    assert instance is not None
    assert instance.kind == "never"
