import json

from prompty.core import BingSearchTool


def test_create_bingsearchtool():
    instance = BingSearchTool()
    assert instance is not None


def test_load_bingsearchtool():
    json_data = """
    {
      "kind": "bing_search",
      "connection": {
        "kind": "provider-connection"
      },
      "configurations": [
        {
          "connectionId": "connectionId",
          "instanceName": "MyBingInstance",
          "market": "en-US",
          "setLang": "en",
          "count": 10,
          "freshness": "Day"
        }
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = BingSearchTool.load(data)
    assert instance is not None
    assert instance.kind == "bing_search"
