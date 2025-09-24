import json

import yaml

from prompty.core import OpenApiTool


def test_load_json_openapitool():
    json_data = """
    {
      "kind": "openapi",
      "connection": {
        "kind": "provider-connection"
      },
      "specification": "https://api.example.com/openapi.json"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = OpenApiTool.load(data)
    assert instance is not None
    assert instance.kind == "openapi"
    assert instance.specification == "https://api.example.com/openapi.json"


def test_load_yaml_openapitool():
    yaml_data = """
    kind: openapi
    connection:
      kind: provider-connection
    specification: https://api.example.com/openapi.json
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = OpenApiTool.load(data)
    assert instance is not None
    assert instance.kind == "openapi"
    assert instance.specification == "https://api.example.com/openapi.json"
