import json

import yaml

from prompty.core import BingSearchTool


def test_load_json_bingsearchtool():
    json_data = """
    {
      "kind": "bing_search",
      "connection": {
        "kind": "provider-connection"
      },
      "configurations": [
        {
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


def test_load_yaml_bingsearchtool():
    yaml_data = """
    kind: bing_search
    connection:
      kind: provider-connection
    configurations:
      - instanceName: MyBingInstance
        market: en-US
        setLang: en
        count: 10
        freshness: Day
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = BingSearchTool.load(data)
    assert instance is not None
    assert instance.kind == "bing_search"
