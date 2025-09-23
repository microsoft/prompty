import json

import yaml

from prompty.core import GenericRegistry


def test_create_genericregistry():
    instance = GenericRegistry()
    assert instance is not None


def test_load_json_genericregistry():
    json_data = """
    {
      "kind": "some-value",
      "repository": "https://my-registry.com",
      "username": "my-username",
      "password": "my-password"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = GenericRegistry.load(data)
    assert instance is not None
    assert instance.kind == "some-value"
    assert instance.repository == "https://my-registry.com"
    assert instance.username == "my-username"
    assert instance.password == "my-password"


def test_load_yaml_genericregistry():
    yaml_data = """
    kind: some-value
    repository: https://my-registry.com
    username: my-username
    password: my-password
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = GenericRegistry.load(data)
    assert instance is not None
    assert instance.kind == "some-value"
    assert instance.repository == "https://my-registry.com"
    assert instance.username == "my-username"
    assert instance.password == "my-password"
