import json

import yaml

from prompty.core import CodeInterpreterTool


def test_load_json_codeinterpretertool():
    json_data = """
    {
      "kind": "code_interpreter",
      "fileIds": [
        "file1",
        "file2"
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = CodeInterpreterTool.load(data)
    assert instance is not None
    assert instance.kind == "code_interpreter"


def test_load_yaml_codeinterpretertool():
    yaml_data = """
    kind: code_interpreter
    fileIds:
      - file1
      - file2
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = CodeInterpreterTool.load(data)
    assert instance is not None
    assert instance.kind == "code_interpreter"
