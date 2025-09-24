import json

import yaml

from prompty.core import AzureContainerRegistry


def test_load_json_azurecontainerregistry():
    json_data = """
    {
      "kind": "acr",
      "subscription": "your-subscription-id",
      "resourceGroup": "your-resource-group",
      "registryName": "your-acr-name"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = AzureContainerRegistry.load(data)
    assert instance is not None
    assert instance.kind == "acr"
    assert instance.subscription == "your-subscription-id"
    assert instance.resourceGroup == "your-resource-group"
    assert instance.registryName == "your-acr-name"


def test_load_yaml_azurecontainerregistry():
    yaml_data = """
    kind: acr
    subscription: your-subscription-id
    resourceGroup: your-resource-group
    registryName: your-acr-name
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = AzureContainerRegistry.load(data)
    assert instance is not None
    assert instance.kind == "acr"
    assert instance.subscription == "your-subscription-id"
    assert instance.resourceGroup == "your-resource-group"
    assert instance.registryName == "your-acr-name"
