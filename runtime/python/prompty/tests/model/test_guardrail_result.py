import json
import yaml

from prompty.model import GuardrailResult

def test_load_json_guardrailresult():
    json_data = r'''
    {
      "allowed": true,
      "reason": "Content is safe"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = GuardrailResult.load(data)
    assert instance is not None
    assert instance.allowed
    assert instance.reason == "Content is safe"

def test_load_yaml_guardrailresult():
    yaml_data = r'''
    allowed: true
    reason: Content is safe
    
    '''
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = GuardrailResult.load(data)
    assert instance is not None
    assert instance.allowed
    assert instance.reason == "Content is safe"

def test_roundtrip_json_guardrailresult():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r'''
    {
      "allowed": true,
      "reason": "Content is safe"
    }
    '''
    original_data = json.loads(json_data, strict=False)
    instance = GuardrailResult.load(original_data)
    saved_data = instance.save()
    reloaded = GuardrailResult.load(saved_data)
    assert reloaded is not None
    assert reloaded.allowed
    assert reloaded.reason == "Content is safe"

def test_to_json_guardrailresult():
    """Test that to_json produces valid JSON."""
    json_data = r'''
    {
      "allowed": true,
      "reason": "Content is safe"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = GuardrailResult.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)

def test_to_yaml_guardrailresult():
    """Test that to_yaml produces valid YAML."""
    json_data = r'''
    {
      "allowed": true,
      "reason": "Content is safe"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = GuardrailResult.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

def test_factory_rewrite_guardrailresult():
    """Test that rewrite() factory creates a valid instance."""
    instance = GuardrailResult.create_rewrite("test")
    assert instance is not None
    assert isinstance(instance, GuardrailResult)
    assert instance.allowed

def test_factory_deny_guardrailresult():
    """Test that deny() factory creates a valid instance."""
    instance = GuardrailResult.deny("test")
    assert instance is not None
    assert isinstance(instance, GuardrailResult)
    assert not instance.allowed

def test_factory_allow_guardrailresult():
    """Test that allow() factory creates a valid instance."""
    instance = GuardrailResult.allow()
    assert instance is not None
    assert isinstance(instance, GuardrailResult)
    assert instance.allowed

