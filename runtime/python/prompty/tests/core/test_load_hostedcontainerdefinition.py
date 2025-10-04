import json

import yaml

from prompty.core import HostedContainerDefinition


def test_load_json_hostedcontainerdefinition():
    json_data = """
    {
      "scale": {
        "minReplicas": 1,
        "maxReplicas": 5,
        "cpu": 0.5,
        "memory": 2
      },
      "context": {
        "dockerfile": "dockerfile",
        "buildContext": "."
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = HostedContainerDefinition.load(data)
    assert instance is not None


def test_load_yaml_hostedcontainerdefinition():
    yaml_data = """
    scale:
      minReplicas: 1
      maxReplicas: 5
      cpu: 0.5
      memory: 2
    context:
      dockerfile: dockerfile
      buildContext: .
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = HostedContainerDefinition.load(data)
    assert instance is not None
