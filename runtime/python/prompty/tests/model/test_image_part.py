
import json
import yaml

from prompty.model import ImagePart


def test_load_json_imagepart():
    json_data = r'''
    {
      "source": "https://example.com/image.png",
      "detail": "auto",
      "mediaType": "image/png"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ImagePart.load(data)
    assert instance is not None
    assert instance.source == "https://example.com/image.png"
    assert instance.detail == "auto"
    assert instance.mediaType == "image/png"
    

def test_load_yaml_imagepart():
    yaml_data = r'''
    source: "https://example.com/image.png"
    detail: auto
    mediaType: image/png
    
    '''
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ImagePart.load(data)
    assert instance is not None
    assert instance.source == "https://example.com/image.png"
    assert instance.detail == "auto"
    assert instance.mediaType == "image/png"

def test_roundtrip_json_imagepart():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r'''
    {
      "source": "https://example.com/image.png",
      "detail": "auto",
      "mediaType": "image/png"
    }
    '''
    original_data = json.loads(json_data, strict=False)
    instance = ImagePart.load(original_data)
    saved_data = instance.save()
    reloaded = ImagePart.load(saved_data)
    assert reloaded is not None
    assert reloaded.source == "https://example.com/image.png"
    assert reloaded.detail == "auto"
    assert reloaded.mediaType == "image/png"

def test_to_json_imagepart():
    """Test that to_json produces valid JSON."""
    json_data = r'''
    {
      "source": "https://example.com/image.png",
      "detail": "auto",
      "mediaType": "image/png"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ImagePart.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)

def test_to_yaml_imagepart():
    """Test that to_yaml produces valid YAML."""
    json_data = r'''
    {
      "source": "https://example.com/image.png",
      "detail": "auto",
      "mediaType": "image/png"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ImagePart.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)


