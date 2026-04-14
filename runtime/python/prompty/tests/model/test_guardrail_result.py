
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


