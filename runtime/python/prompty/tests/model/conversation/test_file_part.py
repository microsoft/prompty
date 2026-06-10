import json

import yaml

from prompty.model import FilePart


def test_load_json_filepart():
    json_data = r"""
    {
      "source": "https://example.com/document.pdf",
      "mediaType": "application/pdf"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = FilePart.load(data)
    assert instance is not None
    assert instance.source == "https://example.com/document.pdf"
    assert instance.media_type == "application/pdf"


def test_load_yaml_filepart():
    yaml_data = r"""
    source: "https://example.com/document.pdf"
    mediaType: application/pdf

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = FilePart.load(data)
    assert instance is not None
    assert instance.source == "https://example.com/document.pdf"
    assert instance.media_type == "application/pdf"


def test_roundtrip_json_filepart():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "source": "https://example.com/document.pdf",
      "mediaType": "application/pdf"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = FilePart.load(original_data)
    saved_data = instance.save()
    reloaded = FilePart.load(saved_data)
    assert reloaded is not None
    assert reloaded.source == "https://example.com/document.pdf"
    assert reloaded.media_type == "application/pdf"


def test_to_json_filepart():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "source": "https://example.com/document.pdf",
      "mediaType": "application/pdf"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = FilePart.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_filepart():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "source": "https://example.com/document.pdf",
      "mediaType": "application/pdf"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = FilePart.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
