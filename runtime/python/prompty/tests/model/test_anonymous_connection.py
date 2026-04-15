import json

import yaml

from prompty.model import AnonymousConnection


def test_load_json_anonymousconnection():
    json_data = r"""
    {
      "kind": "anonymous",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = AnonymousConnection.load(data)
    assert instance is not None
    assert instance.kind == "anonymous"
    assert instance.endpoint == "https://{your-custom-endpoint}.openai.azure.com/"


def test_load_yaml_anonymousconnection():
    yaml_data = r"""
    kind: anonymous
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = AnonymousConnection.load(data)
    assert instance is not None
    assert instance.kind == "anonymous"
    assert instance.endpoint == "https://{your-custom-endpoint}.openai.azure.com/"


def test_roundtrip_json_anonymousconnection():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "kind": "anonymous",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = AnonymousConnection.load(original_data)
    saved_data = instance.save()
    reloaded = AnonymousConnection.load(saved_data)
    assert reloaded is not None
    assert reloaded.kind == "anonymous"
    assert reloaded.endpoint == "https://{your-custom-endpoint}.openai.azure.com/"


def test_to_json_anonymousconnection():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "kind": "anonymous",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = AnonymousConnection.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_anonymousconnection():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "kind": "anonymous",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = AnonymousConnection.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
