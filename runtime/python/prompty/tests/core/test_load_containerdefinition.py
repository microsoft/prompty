import json

import yaml

from prompty.core import ContainerDefinition


def test_create_containerdefinition():
    instance = ContainerDefinition()
    assert instance is not None


def test_load_json_containerdefinition():
    json_data = """
    {
      "image": "my-container-image",
      "tag": "v1.0.0",
      "registry": {
        "kind": "acr",
        "connection": {
          "kind": "key",
          "authority": "system",
          "usageDescription": "Access to the container registry"
        }
      },
      "scale": {
        "minReplicas": 1,
        "maxReplicas": 5,
        "cpu": 0.5,
        "memory": 2
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ContainerDefinition.load(data)
    assert instance is not None
    assert instance.image == "my-container-image"
    assert instance.tag == "v1.0.0"


def test_load_yaml_containerdefinition():
    yaml_data = """
    image: my-container-image
    tag: v1.0.0
    registry:
      kind: acr
      connection:
        kind: key
        authority: system
        usageDescription: Access to the container registry
    scale:
      minReplicas: 1
      maxReplicas: 5
      cpu: 0.5
      memory: 2
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ContainerDefinition.load(data)
    assert instance is not None
    assert instance.image == "my-container-image"
    assert instance.tag == "v1.0.0"
