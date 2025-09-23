import json

import yaml

from prompty.core import Binding


def test_create_binding():
    instance = Binding()
    assert instance is not None


def test_load_json_binding():
    json_data = """
    {
      "name": "my-tool",
      "input": "input-variable"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Binding.load(data)
    assert instance is not None
    assert instance.name == "my-tool"
    assert instance.input == "input-variable"


def test_load_yaml_binding():
    yaml_data = """
    name: my-tool
    input: input-variable
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Binding.load(data)
    assert instance is not None
    assert instance.name == "my-tool"
    assert instance.input == "input-variable"
