import json

from prompty.core import PromptyContainer


def test_create_promptycontainer():
    instance = PromptyContainer()
    assert instance is not None


def test_load_promptycontainer():
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
