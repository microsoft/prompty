import json

import yaml

from prompty.core import OAuthConnection


def test_create_oauthconnection():
    instance = OAuthConnection()
    assert instance is not None


def test_load_json_oauthconnection():
    json_data = """
    {
      "kind": "oauth",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
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
    assert instance.endpoint == "https://{your-custom-endpoint}.openai.azure.com/"
    assert instance.clientId == "your-client-id"
    assert instance.clientSecret == "your-client-secret"
    assert instance.tokenUrl == "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"


def test_load_yaml_oauthconnection():
    yaml_data = """
    kind: oauth
    endpoint: https://{your-custom-endpoint}.openai.azure.com/
    clientId: your-client-id
    clientSecret: your-client-secret
    tokenUrl: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
    scopes:
      - https://cognitiveservices.azure.com/.default
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = OAuthConnection.load(data)
    assert instance is not None
    assert instance.kind == "oauth"
    assert instance.endpoint == "https://{your-custom-endpoint}.openai.azure.com/"
    assert instance.clientId == "your-client-id"
    assert instance.clientSecret == "your-client-secret"
    assert instance.tokenUrl == "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
