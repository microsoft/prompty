import json

import yaml

from prompty.model import RemoteConnection


def test_load_json_remoteconnection():
    json_data = r"""
    {
      "kind": "remote",
      "name": "my-reference-connection",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = RemoteConnection.load(data)
    assert instance is not None
    assert instance.kind == "remote"
    assert instance.name == "my-reference-connection"
    assert instance.endpoint == "https://{your-custom-endpoint}.openai.azure.com/"


def test_load_yaml_remoteconnection():
    yaml_data = r"""
    kind: remote
    name: my-reference-connection
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = RemoteConnection.load(data)
    assert instance is not None
    assert instance.kind == "remote"
    assert instance.name == "my-reference-connection"
    assert instance.endpoint == "https://{your-custom-endpoint}.openai.azure.com/"


def test_roundtrip_json_remoteconnection():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "kind": "remote",
      "name": "my-reference-connection",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = RemoteConnection.load(original_data)
    saved_data = instance.save()
    reloaded = RemoteConnection.load(saved_data)
    assert reloaded is not None
    assert reloaded.kind == "remote"
    assert reloaded.name == "my-reference-connection"
    assert reloaded.endpoint == "https://{your-custom-endpoint}.openai.azure.com/"


def test_to_json_remoteconnection():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "kind": "remote",
      "name": "my-reference-connection",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = RemoteConnection.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_remoteconnection():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "kind": "remote",
      "name": "my-reference-connection",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = RemoteConnection.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
