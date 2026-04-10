import json

import yaml

from prompty.model import Connection


def test_load_json_connection():
    json_data = r"""
    {
      "kind": "reference",
      "authenticationMode": "system",
      "usageDescription": "This will allow the agent to respond to an email on your behalf"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Connection.load(data)
    assert instance is not None
    assert instance.kind == "reference"
    assert instance.authenticationMode == "system"
    assert instance.usageDescription == "This will allow the agent to respond to an email on your behalf"


def test_load_yaml_connection():
    yaml_data = r"""
    kind: reference
    authenticationMode: system
    usageDescription: This will allow the agent to respond to an email on your behalf
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Connection.load(data)
    assert instance is not None
    assert instance.kind == "reference"
    assert instance.authenticationMode == "system"
    assert instance.usageDescription == "This will allow the agent to respond to an email on your behalf"


def test_roundtrip_json_connection():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "kind": "reference",
      "authenticationMode": "system",
      "usageDescription": "This will allow the agent to respond to an email on your behalf"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = Connection.load(original_data)
    saved_data = instance.save()
    reloaded = Connection.load(saved_data)
    assert reloaded is not None
    assert reloaded.kind == "reference"
    assert reloaded.authenticationMode == "system"
    assert reloaded.usageDescription == "This will allow the agent to respond to an email on your behalf"


def test_to_json_connection():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "kind": "reference",
      "authenticationMode": "system",
      "usageDescription": "This will allow the agent to respond to an email on your behalf"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Connection.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_connection():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "kind": "reference",
      "authenticationMode": "system",
      "usageDescription": "This will allow the agent to respond to an email on your behalf"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Connection.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
