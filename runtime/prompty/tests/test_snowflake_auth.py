import pytest
from unittest.mock import Mock, patch, MagicMock
from pathlib import Path

from prompty.core import Prompty, ModelSettings
from prompty.snowflake.executor import SnowflakeCortexExecutor
from prompty.snowflake.processor import SnowflakeCortexProcessor


class TestSnowflakeAuthentication:
    """Test different Snowflake authentication methods"""

    def setup_method(self):
        """Setup test fixtures"""
        self.base_config = {
            "type": "snowflake_cortex",
            "account": "test-account",
            "user": "test-user",
            "warehouse": "test-warehouse",
            "database": "test-database",
            "model": "llama3.1-8b"
        }

    @patch('snowflake.connector.connect')
    def test_password_authentication(self, mock_connect):
        """Test password-based authentication"""
        config = {**self.base_config, "password": "test-password"}
        
        mock_prompty = Mock(spec=Prompty)
        mock_prompty.model = Mock(spec=ModelSettings)
        mock_prompty.model.configuration = config
        mock_prompty.model.parameters = {}
        
        mock_connection = Mock()
        mock_connect.return_value = mock_connection
        
        executor = SnowflakeCortexExecutor(mock_prompty)
        
        # Verify connection was called with password
        mock_connect.assert_called_once()
        call_args = mock_connect.call_args[1]
        assert call_args["password"] == "test-password"
        assert call_args["account"] == "test-account"
        assert call_args["user"] == "test-user"

    @patch('snowflake.connector.connect')
    def test_key_pair_authentication(self, mock_connect):
        """Test key-pair authentication"""
        config = {**self.base_config, "private_key": "fake-key-content"}
        
        mock_prompty = Mock(spec=Prompty)
        mock_prompty.model = Mock(spec=ModelSettings)
        mock_prompty.model.configuration = config
        mock_prompty.model.parameters = {}
        
        mock_connection = Mock()
        mock_connect.return_value = mock_connection
        
        executor = SnowflakeCortexExecutor(mock_prompty)
        
        # Verify connection was called with private key
        mock_connect.assert_called_once()
        call_args = mock_connect.call_args[1]
        assert call_args["private_key"] == "fake-key-content"
        assert "password" not in call_args

    @patch('snowflake.connector.connect')
    @patch('builtins.open', create=True)
    def test_key_pair_file_authentication(self, mock_open, mock_connect):
        """Test key-pair file authentication"""
        config = {**self.base_config, "private_key_path": "/path/to/key.p8"}
        
        mock_prompty = Mock(spec=Prompty)
        mock_prompty.model = Mock(spec=ModelSettings)
        mock_prompty.model.configuration = config
        mock_prompty.model.parameters = {}
        
        # Mock file reading
        mock_file = Mock()
        mock_file.read.return_value = b"private-key-content"
        mock_open.return_value.__enter__.return_value = mock_file
        
        mock_connection = Mock()
        mock_connect.return_value = mock_connection
        
        executor = SnowflakeCortexExecutor(mock_prompty)
        
        # Verify file was opened and content used
        mock_open.assert_called_once_with("/path/to/key.p8", "rb")
        mock_connect.assert_called_once()
        call_args = mock_connect.call_args[1]
        assert call_args["private_key"] == b"private-key-content"

    @patch('snowflake.connector.connect')
    def test_sso_authentication(self, mock_connect):
        """Test SSO authentication"""
        config = {**self.base_config, "authenticator": "externalbrowser"}
        
        mock_prompty = Mock(spec=Prompty)
        mock_prompty.model = Mock(spec=ModelSettings)
        mock_prompty.model.configuration = config
        mock_prompty.model.parameters = {}
        
        mock_connection = Mock()
        mock_connect.return_value = mock_connection
        
        executor = SnowflakeCortexExecutor(mock_prompty)
        
        # Verify connection was called with SSO authenticator
        mock_connect.assert_called_once()
        call_args = mock_connect.call_args[1]
        assert call_args["authenticator"] == "externalbrowser"
        assert "password" not in call_args

    @patch('snowflake.connector.connect')
    def test_oauth_authentication(self, mock_connect):
        """Test OAuth authentication"""
        config = {
            **self.base_config, 
            "authenticator": "oauth",
            "token": "oauth-token-123"
        }
        
        mock_prompty = Mock(spec=Prompty)
        mock_prompty.model = Mock(spec=ModelSettings)
        mock_prompty.model.configuration = config
        mock_prompty.model.parameters = {}
        
        mock_connection = Mock()
        mock_connect.return_value = mock_connection
        
        executor = SnowflakeCortexExecutor(mock_prompty)
        
        # Verify connection was called with OAuth
        mock_connect.assert_called_once()
        call_args = mock_connect.call_args[1]
        assert call_args["authenticator"] == "oauth"
        assert call_args["token"] == "oauth-token-123"

    @patch('snowflake.connector.connect')
    def test_connection_with_role(self, mock_connect):
        """Test connection with role parameter"""
        config = {
            **self.base_config,
            "password": "test-password",
            "role": "DATA_SCIENTIST"
        }
        
        mock_prompty = Mock(spec=Prompty)
        mock_prompty.model = Mock(spec=ModelSettings)
        mock_prompty.model.configuration = config
        mock_prompty.model.parameters = {}
        
        mock_connection = Mock()
        mock_connect.return_value = mock_connection
        
        executor = SnowflakeCortexExecutor(mock_prompty)
        
        # Verify role was included
        mock_connect.assert_called_once()
        call_args = mock_connect.call_args[1]
        assert call_args["role"] == "DATA_SCIENTIST"

    @patch('snowflake.connector.connect')
    def test_connection_with_session_parameters(self, mock_connect):
        """Test connection with session parameters"""
        config = {
            **self.base_config,
            "password": "test-password",
            "session_parameters": {
                "QUERY_TAG": "prompty-test",
                "CLIENT_SESSION_KEEP_ALIVE": True
            }
        }
        
        mock_prompty = Mock(spec=Prompty)
        mock_prompty.model = Mock(spec=ModelSettings)
        mock_prompty.model.configuration = config
        mock_prompty.model.parameters = {}
        
        mock_connection = Mock()
        mock_connect.return_value = mock_connection
        
        executor = SnowflakeCortexExecutor(mock_prompty)
        
        # Verify session parameters were included
        mock_connect.assert_called_once()
        call_args = mock_connect.call_args[1]
        assert call_args["session_parameters"]["QUERY_TAG"] == "prompty-test"
        assert call_args["session_parameters"]["CLIENT_SESSION_KEEP_ALIVE"] is True

    @patch('snowflake.connector.connect')
    def test_connection_failure(self, mock_connect):
        """Test connection failure handling"""
        config = {**self.base_config, "password": "wrong-password"}
        
        mock_prompty = Mock(spec=Prompty)
        mock_prompty.model = Mock(spec=ModelSettings)
        mock_prompty.model.configuration = config
        mock_prompty.model.parameters = {}
        
        # Simulate connection failure
        mock_connect.side_effect = Exception("Authentication failed")
        
        with pytest.raises(ConnectionError) as exc_info:
            SnowflakeCortexExecutor(mock_prompty)
        
        assert "Failed to connect to Snowflake" in str(exc_info.value)


class TestSnowflakeQueryBuilding:
    """Test Snowflake query building functionality"""

    def setup_method(self):
        """Setup test fixtures"""
        self.mock_prompty = Mock(spec=Prompty)
        self.mock_prompty.model = Mock(spec=ModelSettings)
        self.mock_prompty.model.configuration = {
            "model": "llama3.1-8b",
            "type": "snowflake_cortex"
        }

    @patch('snowflake.connector.connect')
    def test_simple_query_building(self, mock_connect):
        """Test basic query building without parameters"""
        self.mock_prompty.model.parameters = {}
        
        mock_connection = Mock()
        mock_connect.return_value = mock_connection
        
        executor = SnowflakeCortexExecutor(self.mock_prompty)
        
        messages = [{"role": "user", "content": "Hello world"}]
        query, params = executor._build_cortex_query(messages)
        
        assert "SNOWFLAKE.CORTEX.COMPLETE" in query
        assert "'llama3.1-8b'" in query
        assert len(params) == 1  # Only prompt, no options
        assert "user: Hello world" in params[0]

    @patch('snowflake.connector.connect')
    def test_query_with_parameters(self, mock_connect):
        """Test query building with parameters"""
        self.mock_prompty.model.parameters = {
            "temperature": 0.7,
            "max_tokens": 1000,
            "top_p": 0.9,
            "stop": ["###", "END"]
        }
        
        mock_connection = Mock()
        mock_connect.return_value = mock_connection
        
        executor = SnowflakeCortexExecutor(self.mock_prompty)
        
        messages = [{"role": "user", "content": "Test message"}]
        query, params = executor._build_cortex_query(messages)
        
        assert len(params) == 2  # Prompt and options
        
        import json
        options = json.loads(params[1])
        assert options["temperature"] == 0.7
        assert options["max_tokens"] == 1000
        assert options["top_p"] == 0.9
        assert options["stop"] == ["###", "END"]    @patch('snowflake.connector.connect')
    def test_query_with_guardrails(self, mock_connect):
        """Test query building with guardrails"""
        self.mock_prompty.model.parameters = {
            "guardrails": True
        }
        
        mock_connection = Mock()
        mock_connect.return_value = mock_connection        
        executor = SnowflakeCortexExecutor(self.mock_prompty)
        
        messages = [{"role": "user", "content": "Test message"}]
        query, params = executor._build_cortex_query(messages)
        
        import json
        options = json.loads(params[1])
        assert options["guardrails"] == True

    @patch('snowflake.connector.connect')
    def test_multimodal_content_handling(self, mock_connect):
        """Test handling of multimodal content"""
        self.mock_prompty.model.parameters = {}
        
        mock_connection = Mock()
        mock_connect.return_value = mock_connection
        
        executor = SnowflakeCortexExecutor(self.mock_prompty)
        
        messages = [{
            "role": "user",
            "content": [
                {"type": "text", "text": "Describe this image"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
            ]
        }]
        query, params = executor._build_cortex_query(messages)
        
        # Should extract only text content (images not supported in CORTEX.COMPLETE)
        assert "Describe this image" in params[0]
        assert "data:image" not in params[0]


class TestSnowflakeErrorHandling:
    """Test error handling scenarios"""

    @patch('snowflake.connector.connect')
    def test_sql_execution_error(self, mock_connect):
        """Test SQL execution error handling"""
        config = {
            "type": "snowflake_cortex",
            "account": "test-account",
            "user": "test-user", 
            "password": "test-password",
            "warehouse": "test-warehouse",
            "database": "test-database",
            "model": "llama3.1-8b"
        }
        
        mock_prompty = Mock(spec=Prompty)
        mock_prompty.model = Mock(spec=ModelSettings)
        mock_prompty.model.configuration = config
        mock_prompty.model.parameters = {}
        
        mock_connection = Mock()
        mock_cursor = Mock()
        mock_connect.return_value = mock_connection
        mock_connection.cursor.return_value.__enter__.return_value = mock_cursor
        
        # Simulate SQL execution error
        mock_cursor.execute.side_effect = Exception("SQL execution failed")
        
        executor = SnowflakeCortexExecutor(mock_prompty)
        
        with pytest.raises(Exception) as exc_info:
            executor.invoke("test message")
        
        assert "SQL execution failed" in str(exc_info.value)

    @patch('snowflake.connector.connect')
    def test_no_connection_error(self, mock_connect):
        """Test error when connection is not established"""
        mock_prompty = Mock(spec=Prompty)
        mock_prompty.model = Mock(spec=ModelSettings)
        mock_prompty.model.configuration = {"type": "snowflake_cortex"}
        mock_prompty.model.parameters = {}
        
        # Simulate connection failure
        mock_connect.side_effect = Exception("Connection failed")
        
        with pytest.raises(ConnectionError):
            executor = SnowflakeCortexExecutor(mock_prompty)
            executor.connection = None  # Force no connection
            executor.invoke("test message")


if __name__ == "__main__":
    pytest.main([__file__])
