import json

import yaml

from prompty.core import Scale


def test_load_json_scale():
    json_data = """
    {
      "minReplicas": 1,
      "maxReplicas": 5,
      "cpu": 0.5,
      "memory": 2
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Scale.load(data)
    assert instance is not None
    assert instance.minReplicas == 1
    assert instance.maxReplicas == 5
    assert instance.cpu == 0.5
    assert instance.memory == 2


def test_load_yaml_scale():
    yaml_data = """
    minReplicas: 1
    maxReplicas: 5
    cpu: 0.5
    memory: 2
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Scale.load(data)
    assert instance is not None
    assert instance.minReplicas == 1
    assert instance.maxReplicas == 5
    assert instance.cpu == 0.5
    assert instance.memory == 2
