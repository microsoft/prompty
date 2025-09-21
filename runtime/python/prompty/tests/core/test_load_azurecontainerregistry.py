import json

from prompty.core import AzureContainerRegistry


def test_create_azurecontainerregistry():
    instance = AzureContainerRegistry()
    assert instance is not None


def test_load_azurecontainerregistry():
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
