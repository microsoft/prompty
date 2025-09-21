import json

from prompty.core import EnvironmentVariable


def test_create_environmentvariable():
    instance = EnvironmentVariable()
    assert instance is not None


def test_load_environmentvariable():
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
