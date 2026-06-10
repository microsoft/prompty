import json

import yaml

from prompty.model import LlmCompletePayload


def test_load_json_llmcompletepayload():
    json_data = r"""
    {
      "requestId": "req_abc123",
      "serviceRequestId": "srv_abc123",
      "durationMs": 820
    }
    """
    data = json.loads(json_data, strict=False)
    instance = LlmCompletePayload.load(data)
    assert instance is not None
    assert instance.request_id == "req_abc123"
    assert instance.service_request_id == "srv_abc123"
    assert instance.duration_ms == 820


def test_load_yaml_llmcompletepayload():
    yaml_data = r"""
    requestId: req_abc123
    serviceRequestId: srv_abc123
    durationMs: 820

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = LlmCompletePayload.load(data)
    assert instance is not None
    assert instance.request_id == "req_abc123"
    assert instance.service_request_id == "srv_abc123"
    assert instance.duration_ms == 820


def test_roundtrip_json_llmcompletepayload():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "requestId": "req_abc123",
      "serviceRequestId": "srv_abc123",
      "durationMs": 820
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = LlmCompletePayload.load(original_data)
    saved_data = instance.save()
    reloaded = LlmCompletePayload.load(saved_data)
    assert reloaded is not None
    assert reloaded.request_id == "req_abc123"
    assert reloaded.service_request_id == "srv_abc123"
    assert reloaded.duration_ms == 820


def test_to_json_llmcompletepayload():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "requestId": "req_abc123",
      "serviceRequestId": "srv_abc123",
      "durationMs": 820
    }
    """
    data = json.loads(json_data, strict=False)
    instance = LlmCompletePayload.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_llmcompletepayload():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "requestId": "req_abc123",
      "serviceRequestId": "srv_abc123",
      "durationMs": 820
    }
    """
    data = json.loads(json_data, strict=False)
    instance = LlmCompletePayload.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
