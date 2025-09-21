import json

from prompty.core import FileSearchTool


def test_create_filesearchtool():
    instance = FileSearchTool()
    assert instance is not None


def test_load_filesearchtool():
    json_data = """
    {
      "kind": "file_search",
      "connection": {
        "kind": "provider-connection"
      },
      "maxNumResults": 10,
      "ranker": "default",
      "scoreThreshold": 0.5
    }
    """
    data = json.loads(json_data, strict=False)
    instance = FileSearchTool.load(data)
    assert instance is not None
    assert instance.kind == "file_search"
    assert instance.maxNumResults == 10
    assert instance.ranker == "default"
    assert instance.scoreThreshold == 0.5
