import json

import yaml

from prompty.core import PromptyContainer


def test_create_promptycontainer():
    instance = PromptyContainer()
    assert instance is not None


def test_load_json_promptycontainer():
    json_data = """
    {
      "kind": "container",
      "protocol": "responses",
      "container": {
        "image": "my-container-image",
        "registry": {
          "kind": "acr",
          "subscription": "my-subscription-id"
        }
      },
      "environmentVariables": {
        "MY_ENV_VAR": "my-value"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PromptyContainer.load(data)
    assert instance is not None
    assert instance.kind == "container"
    assert instance.protocol == "responses"


def test_load_yaml_promptycontainer():
    yaml_data = """
    kind: container
    protocol: responses
    container:
      image: my-container-image
      registry:
        kind: acr
        subscription: my-subscription-id
    environmentVariables:
      MY_ENV_VAR: my-value
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = PromptyContainer.load(data)
    assert instance is not None
    assert instance.kind == "container"
    assert instance.protocol == "responses"
