import json

import yaml

from prompty.core import EnvironmentVariable


def test_load_json_environmentvariable():
    json_data = """
    {
      "name": "MY_ENV_VAR",
      "value": "my-value"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = EnvironmentVariable.load(data)
    assert instance is not None
    assert instance.name == "MY_ENV_VAR"
    assert instance.value == "my-value"


def test_load_yaml_environmentvariable():
    yaml_data = """
    name: MY_ENV_VAR
    value: my-value
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = EnvironmentVariable.load(data)
    assert instance is not None
    assert instance.name == "MY_ENV_VAR"
    assert instance.value == "my-value"


def test_load_environmentvariable_from_string():
    instance = EnvironmentVariable.load("example")
    assert instance is not None
    assert instance.value == "example"
