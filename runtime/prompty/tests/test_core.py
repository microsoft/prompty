import prompty
from pathlib import Path
from prompty.tracer import to_dict


class TestCore:
    def test_prompty_to_dict(self, **kwargs):
        prompt_file = "prompts/basic.prompty"
        p = prompty.load(prompt_file)
        d = to_dict(p)
        assert d["name"] == "Basic Prompt"
        assert d["model"]["configuration"]["type"] == "azure"
        assert d["model"]["configuration"]["azure_deployment"] == "gpt-35-turbo"
        assert d["template"]["type"] == "jinja2"


    def test_prompty_to_safe_dict(self, **kwargs):
        prompt_file_base = "prompts/fake.prompty"
        p_base = prompty.load(prompt_file_base)
        prompt_file = "prompts/chat.prompty"
        p = prompty.load(prompt_file)
        p.basePrompty = p_base
        p.inputs = {}
        p.inputs["key1"] = prompty.PropertySettings(type="string", default="value1", description="key1 description")
        p.inputs["key2"] = prompty.PropertySettings(type="string", default="value2", description="key2 description")
        p.outputs = {}
        p.outputs["key3"] = prompty.PropertySettings(type="number", default="99", description="key3 description")
        p.outputs["key4"] = prompty.PropertySettings(type="string", default="value4", description="key4 description")
        p.file = "/path/to/file"
        d = p.to_safe_dict()
        assert d["name"] == "Basic Prompt"
        assert d["model"]["configuration"]["type"] == "azure"
        assert d["model"]["configuration"]["azure_deployment"] == "gpt-35-turbo"
        assert d["template"]["type"] == "jinja2"
        assert d["inputs"]["key2"]["type"] == "string"
        assert d["inputs"]["key2"]["default"] == "value2"
        assert d["inputs"]["key2"]["description"] == "key2 description"
        assert d["outputs"]["key3"]["type"] == "number"
        assert d["outputs"]["key3"]["default"] == "99"
        assert d["outputs"]["key3"]["description"] == "key3 description"
        assert d["file"] == "/path/to/file"
        assert "basePrompty" not in d


    def test_prompty_to_safe_dict_file_path(self, **kwargs):
        prompt_file = "prompts/chat.prompty"
        p = prompty.load(prompt_file)
        p.file = Path("/path/to/file")
        d = p.to_safe_dict()
        assert d["file"] == "/path/to/file"
