import json

import yaml

from prompty.model import InvokerError


def test_load_json_invokererror():
    json_data = r"""
    {
      "message": "No renderer registered for key: jinja2",
      "component": "renderer",
      "key": "jinja2"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = InvokerError.load(data)
    assert instance is not None
    assert instance.message == "No renderer registered for key: jinja2"
    assert instance.component == "renderer"
    assert instance.key == "jinja2"


def test_load_yaml_invokererror():
    yaml_data = r"""
    message: "No renderer registered for key: jinja2"
    component: renderer
    key: jinja2
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = InvokerError.load(data)
    assert instance is not None
    assert instance.message == "No renderer registered for key: jinja2"
    assert instance.component == "renderer"
    assert instance.key == "jinja2"


def test_roundtrip_json_invokererror():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "message": "No renderer registered for key: jinja2",
      "component": "renderer",
      "key": "jinja2"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = InvokerError.load(original_data)
    saved_data = instance.save()
    reloaded = InvokerError.load(saved_data)
    assert reloaded is not None
    assert reloaded.message == "No renderer registered for key: jinja2"
    assert reloaded.component == "renderer"
    assert reloaded.key == "jinja2"


def test_to_json_invokererror():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "message": "No renderer registered for key: jinja2",
      "component": "renderer",
      "key": "jinja2"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = InvokerError.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_invokererror():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "message": "No renderer registered for key: jinja2",
      "component": "renderer",
      "key": "jinja2"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = InvokerError.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
