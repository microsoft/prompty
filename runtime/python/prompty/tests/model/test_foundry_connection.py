import json

import yaml

from prompty.model import FoundryConnection


def test_load_json_foundryconnection():
    json_data = r"""
    {
      "kind": "foundry",
      "endpoint": "https://myresource.services.ai.azure.com/api/projects/myproject",
      "name": "my-openai-connection",
      "connectionType": "model"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = FoundryConnection.load(data)
    assert instance is not None
    assert instance.kind == "foundry"
    assert instance.endpoint == "https://myresource.services.ai.azure.com/api/projects/myproject"
    assert instance.name == "my-openai-connection"
    assert instance.connectionType == "model"


def test_load_yaml_foundryconnection():
    yaml_data = r"""
    kind: foundry
    endpoint: "https://myresource.services.ai.azure.com/api/projects/myproject"
    name: my-openai-connection
    connectionType: model
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = FoundryConnection.load(data)
    assert instance is not None
    assert instance.kind == "foundry"
    assert instance.endpoint == "https://myresource.services.ai.azure.com/api/projects/myproject"
    assert instance.name == "my-openai-connection"
    assert instance.connectionType == "model"


def test_roundtrip_json_foundryconnection():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "kind": "foundry",
      "endpoint": "https://myresource.services.ai.azure.com/api/projects/myproject",
      "name": "my-openai-connection",
      "connectionType": "model"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = FoundryConnection.load(original_data)
    saved_data = instance.save()
    reloaded = FoundryConnection.load(saved_data)
    assert reloaded is not None
    assert reloaded.kind == "foundry"
    assert reloaded.endpoint == "https://myresource.services.ai.azure.com/api/projects/myproject"
    assert reloaded.name == "my-openai-connection"
    assert reloaded.connectionType == "model"


def test_to_json_foundryconnection():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "kind": "foundry",
      "endpoint": "https://myresource.services.ai.azure.com/api/projects/myproject",
      "name": "my-openai-connection",
      "connectionType": "model"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = FoundryConnection.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_foundryconnection():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "kind": "foundry",
      "endpoint": "https://myresource.services.ai.azure.com/api/projects/myproject",
      "name": "my-openai-connection",
      "connectionType": "model"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = FoundryConnection.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
