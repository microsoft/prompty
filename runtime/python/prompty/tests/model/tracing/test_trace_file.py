import json
import yaml

from prompty.model import TraceFile

def test_load_json_tracefile():
    json_data = r'''
    {
      "runtime": "python",
      "version": "2.0.0"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = TraceFile.load(data)
    assert instance is not None
    assert instance.runtime == "python"
    assert instance.version == "2.0.0"

def test_load_yaml_tracefile():
    yaml_data = r'''
    runtime: python
    version: 2.0.0
    
    '''
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = TraceFile.load(data)
    assert instance is not None
    assert instance.runtime == "python"
    assert instance.version == "2.0.0"

def test_roundtrip_json_tracefile():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r'''
    {
      "runtime": "python",
      "version": "2.0.0"
    }
    '''
    original_data = json.loads(json_data, strict=False)
    instance = TraceFile.load(original_data)
    saved_data = instance.save()
    reloaded = TraceFile.load(saved_data)
    assert reloaded is not None
    assert reloaded.runtime == "python"
    assert reloaded.version == "2.0.0"

def test_to_json_tracefile():
    """Test that to_json produces valid JSON."""
    json_data = r'''
    {
      "runtime": "python",
      "version": "2.0.0"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = TraceFile.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)

def test_to_yaml_tracefile():
    """Test that to_yaml produces valid YAML."""
    json_data = r'''
    {
      "runtime": "python",
      "version": "2.0.0"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = TraceFile.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

