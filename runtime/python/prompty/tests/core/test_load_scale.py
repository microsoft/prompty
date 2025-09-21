import json

from prompty.core import Scale


def test_create_scale():
    instance = Scale()
    assert instance is not None


def test_load_scale():
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
