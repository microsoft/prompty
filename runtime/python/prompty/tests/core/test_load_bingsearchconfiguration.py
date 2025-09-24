import json

import yaml

from prompty.core import BingSearchConfiguration


def test_load_json_bingsearchconfiguration():
    json_data = """
    {
      "name": "my-configuration"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = BingSearchConfiguration.load(data)
    assert instance is not None
    assert instance.name == "my-configuration"


def test_load_yaml_bingsearchconfiguration():
    yaml_data = """
    name: my-configuration
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = BingSearchConfiguration.load(data)
    assert instance is not None
    assert instance.name == "my-configuration"
