import json

import yaml

from prompty.core import PromptyWorkflow


def test_load_json_promptyworkflow():
    json_data = """
    {
      "kind": "workflow"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PromptyWorkflow.load(data)
    assert instance is not None
    assert instance.kind == "workflow"


def test_load_yaml_promptyworkflow():
    yaml_data = """
    kind: workflow
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = PromptyWorkflow.load(data)
    assert instance is not None
    assert instance.kind == "workflow"
