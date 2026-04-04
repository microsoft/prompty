import json

import yaml

from prompty.model import ApiKeyConnection


def test_load_json_apikeyconnection():
    json_data = r"""
    {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "your-api-key"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ApiKeyConnection.load(data)
    assert instance is not None
    assert instance.kind == "key"
    assert instance.endpoint == "https://{your-custom-endpoint}.openai.azure.com/"
    assert instance.apiKey == "your-api-key"


def test_load_yaml_apikeyconnection():
    yaml_data = r"""
    kind: key
    endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
    apiKey: your-api-key
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ApiKeyConnection.load(data)
    assert instance is not None
    assert instance.kind == "key"
    assert instance.endpoint == "https://{your-custom-endpoint}.openai.azure.com/"
    assert instance.apiKey == "your-api-key"


def test_roundtrip_json_apikeyconnection():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "your-api-key"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = ApiKeyConnection.load(original_data)
    saved_data = instance.save()
    reloaded = ApiKeyConnection.load(saved_data)
    assert reloaded is not None
    assert reloaded.kind == "key"
    assert reloaded.endpoint == "https://{your-custom-endpoint}.openai.azure.com/"
    assert reloaded.apiKey == "your-api-key"


def test_to_json_apikeyconnection():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "your-api-key"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ApiKeyConnection.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_apikeyconnection():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "apiKey": "your-api-key"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ApiKeyConnection.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
