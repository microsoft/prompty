import json

import yaml

from prompty.model import RetryPayload


def test_load_json_retrypayload():
    json_data = r"""
    {
      "operation": "llm",
      "attempt": 2,
      "maxAttempts": 3,
      "delayMs": 1250,
      "reason": "rate_limit"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = RetryPayload.load(data)
    assert instance is not None
    assert instance.operation == "llm"
    assert instance.attempt == 2
    assert instance.max_attempts == 3
    assert instance.delay_ms == 1250
    assert instance.reason == "rate_limit"


def test_load_yaml_retrypayload():
    yaml_data = r"""
    operation: llm
    attempt: 2
    maxAttempts: 3
    delayMs: 1250
    reason: rate_limit

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = RetryPayload.load(data)
    assert instance is not None
    assert instance.operation == "llm"
    assert instance.attempt == 2
    assert instance.max_attempts == 3
    assert instance.delay_ms == 1250
    assert instance.reason == "rate_limit"


def test_roundtrip_json_retrypayload():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "operation": "llm",
      "attempt": 2,
      "maxAttempts": 3,
      "delayMs": 1250,
      "reason": "rate_limit"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = RetryPayload.load(original_data)
    saved_data = instance.save()
    reloaded = RetryPayload.load(saved_data)
    assert reloaded is not None
    assert reloaded.operation == "llm"
    assert reloaded.attempt == 2
    assert reloaded.max_attempts == 3
    assert reloaded.delay_ms == 1250
    assert reloaded.reason == "rate_limit"


def test_to_json_retrypayload():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "operation": "llm",
      "attempt": 2,
      "maxAttempts": 3,
      "delayMs": 1250,
      "reason": "rate_limit"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = RetryPayload.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_retrypayload():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "operation": "llm",
      "attempt": 2,
      "maxAttempts": 3,
      "delayMs": 1250,
      "reason": "rate_limit"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = RetryPayload.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
