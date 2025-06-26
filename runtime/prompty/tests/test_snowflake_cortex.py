from pathlib import Path

import pytest

import prompty
from prompty.snowflake import SnowflakeCortexProcessor
from prompty.invoker import InvokerFactory
from tests.fake_snowflake_executor import FakeSnowflakeExecutor


@pytest.fixture(scope="module", autouse=True)
def fake_snowflake_executor():
    """Register fake Snowflake executor for testing"""
    InvokerFactory.add_executor("snowflake", FakeSnowflakeExecutor)
    InvokerFactory.add_executor("snowflake_cortex", FakeSnowflakeExecutor)
    InvokerFactory.add_processor("snowflake", SnowflakeCortexProcessor)
    InvokerFactory.add_processor("snowflake_cortex", SnowflakeCortexProcessor)


BASE_PATH = str(Path(__file__).absolute().parent.as_posix())


@pytest.mark.parametrize(
    "prompt",
    [
        "prompts/snowflake_basic.prompty",
        "prompts/snowflake_guardrails.prompty",
        "prompts/snowflake_completion.prompty",
        "prompts/snowflake_streaming.prompty",
    ],
)
def test_snowflake_cortex_prompts(prompt: str):
    """Test various Snowflake Cortex prompty configurations"""
    p = prompty.load(prompt)
    result = p()
    print(f"\n=== Testing {prompt} ===")
    print(f"Result type: {type(result)}")
    print(f"Result: {result}")
    assert result is not None


def test_snowflake_basic_chat():
    """Test basic Snowflake Cortex chat functionality"""
    p = prompty.load("prompts/snowflake_basic.prompty")
    result = p()
    
    # Should return a string response from processor
    assert isinstance(result, str)
    assert "Alice" in result  # Should mention the customer name
    assert "Snowflake" in result  # Should mention Snowflake


def test_snowflake_guardrails_json():
    """Test Snowflake Cortex with guardrails and JSON output"""
    p = prompty.load("prompts/snowflake_guardrails.prompty")
    result = p()
    
    # Should return JSON string
    assert isinstance(result, str)
    import json
    json_result = json.loads(result)
    assert "title" in json_result
    assert "Senior Data Engineer" in json_result["title"]
    assert "experience_level" in json_result
    assert json_result["experience_level"] == "senior"


def test_snowflake_completion_api():
    """Test Snowflake Cortex completion API"""
    p = prompty.load("prompts/snowflake_completion.prompty")
    result = p()
    
    assert isinstance(result, str)
    assert "machine learning" in result.lower()
    assert "enterprise" in result.lower()


def test_snowflake_streaming_simulation():
    """Test Snowflake Cortex streaming simulation"""
    p = prompty.load("prompts/snowflake_streaming.prompty")
    result = p()
    
    # Streaming should still return a final string result after processing
    assert isinstance(result, str)
    assert "cloud computing" in result.lower()


def test_snowflake_processor_chat_response():
    """Test Snowflake processor with chat response format"""
    from prompty.core import Prompty, ModelSettings
    from unittest.mock import Mock
    
    # Create mock prompty
    mock_prompty = Mock(spec=Prompty)
    mock_prompty.model = Mock(spec=ModelSettings)
    mock_prompty.model.api = "chat"
    mock_prompty.model.response = "first"
    
    processor = SnowflakeCortexProcessor(mock_prompty)
    
    # Test with Snowflake-style response
    response_data = {
        "choices": [{
            "message": {
                "role": "assistant",
                "content": "Hello, this is a test response."
            },
            "finish_reason": "stop",
            "index": 0
        }]
    }
    
    result = processor.invoke(response_data)
    assert result == "Hello, this is a test response."


def test_snowflake_processor_completion_response():
    """Test Snowflake processor with completion response format"""
    from prompty.core import Prompty, ModelSettings
    from unittest.mock import Mock
    
    mock_prompty = Mock(spec=Prompty)
    mock_prompty.model = Mock(spec=ModelSettings)
    mock_prompty.model.api = "completion"
    mock_prompty.model.response = "first"
    
    processor = SnowflakeCortexProcessor(mock_prompty)
    
    # Test with completion response
    response_data = {
        "choices": [{
            "text": "This is a completion response.",
            "finish_reason": "stop",
            "index": 0
        }]
    }
    
    result = processor.invoke(response_data)
    assert result == "This is a completion response."


def test_snowflake_processor_all_responses():
    """Test Snowflake processor returning all responses"""
    from prompty.core import Prompty, ModelSettings
    from unittest.mock import Mock
    
    mock_prompty = Mock(spec=Prompty)
    mock_prompty.model = Mock(spec=ModelSettings)
    mock_prompty.model.api = "chat"
    mock_prompty.model.response = "all"
    
    processor = SnowflakeCortexProcessor(mock_prompty)
    
    # Test with multiple choices
    response_data = {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": "First response"
                },
                "finish_reason": "stop",
                "index": 0
            },
            {
                "message": {
                    "role": "assistant", 
                    "content": "Second response"
                },
                "finish_reason": "stop",
                "index": 1
            }
        ]
    }
    
    result = processor.invoke(response_data)
    assert isinstance(result, list)
    assert len(result) == 2
    assert result[0] == "First response"
    assert result[1] == "Second response"


def test_snowflake_parameters_mapping():
    """Test that Snowflake executor properly maps parameters"""
    from prompty.core import Prompty, ModelSettings
    from unittest.mock import Mock, patch
    
    # Create mock prompty with parameters
    mock_prompty = Mock(spec=Prompty)
    mock_prompty.model = Mock(spec=ModelSettings)
    mock_prompty.model.configuration = {
        "type": "snowflake_cortex",
        "account": "test-account",
        "user": "test-user",
        "password": "test-password",
        "warehouse": "test-warehouse",
        "database": "test-database",        
        "model": "llama3.1-8b"
    }
    mock_prompty.model.parameters = {
        "temperature": 0.7,
        "max_tokens": 1000,
        "top_p": 0.9,
        "top_k": 50,
        "guardrails": True,
        "response_format": {
            "type": "json_object"
        }
    }
    
    # Mock the Snowflake connection to avoid actual connection
    with patch('snowflake.connector.connect') as mock_connect:
        mock_connection = Mock()
        mock_cursor = Mock()
        mock_connect.return_value = mock_connection
        mock_connection.cursor.return_value.__enter__.return_value = mock_cursor
        mock_cursor.fetchone.return_value = {"response": "Test response"}
        
        from prompty.snowflake.executor import SnowflakeCortexExecutor
        executor = SnowflakeCortexExecutor(mock_prompty)
        
        # Test parameter mapping in query building
        messages = [{"role": "user", "content": "Test message"}]
        query, params = executor._build_cortex_query(messages)
        
        # Verify parameters are included in the query
        assert "SNOWFLAKE.CORTEX.COMPLETE" in query
        assert len(params) >= 2  # Should have prompt and options
        
        # Parse the options to verify parameter mapping
        import json
        options = json.loads(params[1])
        assert options["temperature"] == 0.7
        assert options["max_tokens"] == 1000
        assert options["top_p"] == 0.9
        assert options["top_k"] == 50
        assert options["guardrails"] == True
        assert options["response_format"]["type"] == "json_object"


if __name__ == "__main__":
    pytest.main([__file__])
