from pathlib import Path

import prompty
from prompty.tracer import to_dict


class TestCore:
    def test_prompty_to_dict(self, **kwargs):
        prompt_file = "prompts/basic.prompty"
        p = prompty.load(prompt_file)
        d = to_dict(p)
        assert d["name"] == "Basic Prompt"
        assert d["model"]["connection"]["type"] == "azure"
        assert d["model"]["connection"]["azure_deployment"] == "gpt-35-turbo"
        assert d["template"]["format"] == "jinja2"

    def test_prompty_to_safe_dict(self, **kwargs):
        prompt_file_base = "prompts/fake.prompty"
        p_base = prompty.load(prompt_file_base)
        prompt_file = "prompts/chat.prompty"
        p = prompty.load(prompt_file)
        p.basePrompty = p_base
        p.inputs = {"key1": "value1", "key2": "value2"}  # type: ignore
        p.outputs = {"key3": "value3", "key4": "value4"}  # type: ignore
        p.file = "/path/to/file"
        d = p.to_safe_dict()
        assert d["name"] == "Basic Prompt"
        assert d["model"]["connection"]["type"] == "azure"
        assert d["model"]["connection"]["azure_deployment"] == "gpt-35-turbo"
        assert d["template"]["format"] == "jinja2"
        assert d["file"] == "/path/to/file"
        assert "basePrompty" not in d

    def test_prompty_to_safe_dict_file_path(self, **kwargs):
        prompt_file = "prompts/chat.prompty"
        p = prompty.load(prompt_file)
        p.file = Path("/path/to/file")
        d = p.to_safe_dict()
        assert d["file"] == "/path/to/file"
