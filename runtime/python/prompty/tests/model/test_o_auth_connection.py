import json

import yaml

from prompty.model import OAuthConnection


def test_load_json_oauthconnection():
    json_data = r"""
    {
      "kind": "oauth",
      "endpoint": "https://api.example.com",
      "clientId": "your-client-id",
      "clientSecret": "your-client-secret",
      "tokenUrl": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
      "scopes": [
        "https://cognitiveservices.azure.com/.default"
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = OAuthConnection.load(data)
    assert instance is not None
    assert instance.kind == "oauth"
    assert instance.endpoint == "https://api.example.com"
    assert instance.clientId == "your-client-id"
    assert instance.clientSecret == "your-client-secret"
    assert instance.tokenUrl == "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"


def test_load_yaml_oauthconnection():
    yaml_data = r"""
    kind: oauth
    endpoint: "https://api.example.com"
    clientId: your-client-id
    clientSecret: your-client-secret
    tokenUrl: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
    scopes:
      - "https://cognitiveservices.azure.com/.default"
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = OAuthConnection.load(data)
    assert instance is not None
    assert instance.kind == "oauth"
    assert instance.endpoint == "https://api.example.com"
    assert instance.clientId == "your-client-id"
    assert instance.clientSecret == "your-client-secret"
    assert instance.tokenUrl == "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"


def test_roundtrip_json_oauthconnection():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "kind": "oauth",
      "endpoint": "https://api.example.com",
      "clientId": "your-client-id",
      "clientSecret": "your-client-secret",
      "tokenUrl": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
      "scopes": [
        "https://cognitiveservices.azure.com/.default"
      ]
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = OAuthConnection.load(original_data)
    saved_data = instance.save()
    reloaded = OAuthConnection.load(saved_data)
    assert reloaded is not None
    assert reloaded.kind == "oauth"
    assert reloaded.endpoint == "https://api.example.com"
    assert reloaded.clientId == "your-client-id"
    assert reloaded.clientSecret == "your-client-secret"
    assert reloaded.tokenUrl == "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"


def test_to_json_oauthconnection():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "kind": "oauth",
      "endpoint": "https://api.example.com",
      "clientId": "your-client-id",
      "clientSecret": "your-client-secret",
      "tokenUrl": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
      "scopes": [
        "https://cognitiveservices.azure.com/.default"
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = OAuthConnection.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_oauthconnection():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "kind": "oauth",
      "endpoint": "https://api.example.com",
      "clientId": "your-client-id",
      "clientSecret": "your-client-secret",
      "tokenUrl": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
      "scopes": [
        "https://cognitiveservices.azure.com/.default"
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = OAuthConnection.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
