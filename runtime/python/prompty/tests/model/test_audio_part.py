

import json

import yaml

from prompty.model import AudioPart


def test_load_json_audiopart():
    json_data = r'''
    {
      "source": "https://example.com/audio.wav",
      "mediaType": "audio/wav"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = AudioPart.load(data)
    assert instance is not None
    assert instance.source == "https://example.com/audio.wav"
    assert instance.media_type == "audio/wav"
    

def test_load_yaml_audiopart():
    yaml_data = r'''
    source: "https://example.com/audio.wav"
    mediaType: audio/wav
    
    '''
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = AudioPart.load(data)
    assert instance is not None
    assert instance.source == "https://example.com/audio.wav"
    assert instance.media_type == "audio/wav"

def test_roundtrip_json_audiopart():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r'''
    {
      "source": "https://example.com/audio.wav",
      "mediaType": "audio/wav"
    }
    '''
    original_data = json.loads(json_data, strict=False)
    instance = AudioPart.load(original_data)
    saved_data = instance.save()
    reloaded = AudioPart.load(saved_data)
    assert reloaded is not None
    assert reloaded.source == "https://example.com/audio.wav"
    assert reloaded.media_type == "audio/wav"

def test_to_json_audiopart():
    """Test that to_json produces valid JSON."""
    json_data = r'''
    {
      "source": "https://example.com/audio.wav",
      "mediaType": "audio/wav"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = AudioPart.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)

def test_to_yaml_audiopart():
    """Test that to_yaml produces valid YAML."""
    json_data = r'''
    {
      "source": "https://example.com/audio.wav",
      "mediaType": "audio/wav"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = AudioPart.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)


