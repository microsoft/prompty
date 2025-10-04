import json

import yaml

from prompty.core import PromptyHostedContainer


def test_load_json_promptyhostedcontainer():
    json_data = """
    {
      "kind": "hosted",
      "protocol": "responses",
      "container": {
        "scale": {
          "minReplicas": 1,
          "maxReplicas": 5,
          "cpu": 0.5,
          "memory": 2
        }
      },
      "context": {
        "dockerfile": "dockerfile",
        "buildContext": "."
      },
      "environmentVariables": {
        "MY_ENV_VAR": "my-value"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PromptyHostedContainer.load(data)
    assert instance is not None
    assert instance.kind == "hosted"
    assert instance.protocol == "responses"


def test_load_yaml_promptyhostedcontainer():
    yaml_data = """
    kind: hosted
    protocol: responses
    container:
      scale:
        minReplicas: 1
        maxReplicas: 5
        cpu: 0.5
        memory: 2
    context:
      dockerfile: dockerfile
      buildContext: .
    environmentVariables:
      MY_ENV_VAR: my-value
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = PromptyHostedContainer.load(data)
    assert instance is not None
    assert instance.kind == "hosted"
    assert instance.protocol == "responses"
