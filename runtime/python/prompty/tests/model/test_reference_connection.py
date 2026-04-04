import json

import yaml

from prompty.model import ReferenceConnection


def test_load_json_referenceconnection():
    json_data = r"""
    {
      "kind": "reference",
      "name": "my-reference-connection",
      "target": "my-target-resource"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ReferenceConnection.load(data)
    assert instance is not None
    assert instance.kind == "reference"
    assert instance.name == "my-reference-connection"
    assert instance.target == "my-target-resource"


def test_load_yaml_referenceconnection():
    yaml_data = r"""
    kind: reference
    name: my-reference-connection
    target: my-target-resource
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ReferenceConnection.load(data)
    assert instance is not None
    assert instance.kind == "reference"
    assert instance.name == "my-reference-connection"
    assert instance.target == "my-target-resource"


def test_roundtrip_json_referenceconnection():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "kind": "reference",
      "name": "my-reference-connection",
      "target": "my-target-resource"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = ReferenceConnection.load(original_data)
    saved_data = instance.save()
    reloaded = ReferenceConnection.load(saved_data)
    assert reloaded is not None
    assert reloaded.kind == "reference"
    assert reloaded.name == "my-reference-connection"
    assert reloaded.target == "my-target-resource"


def test_to_json_referenceconnection():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "kind": "reference",
      "name": "my-reference-connection",
      "target": "my-target-resource"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ReferenceConnection.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_referenceconnection():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "kind": "reference",
      "name": "my-reference-connection",
      "target": "my-target-resource"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ReferenceConnection.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
