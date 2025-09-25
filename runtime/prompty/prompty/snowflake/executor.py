import importlib.metadata
import json
import typing
from typing import Any, Dict, List, Optional, Union

import snowflake.connector
from snowflake.connector import DictCursor

from prompty.tracer import Tracer

from ..core import Prompty, PromptyStream
from ..invoker import Invoker, InvokerFactory

VERSION = importlib.metadata.version("prompty")


@InvokerFactory.register_executor("snowflake")
@InvokerFactory.register_executor("snowflake_cortex")
class SnowflakeCortexExecutor(Invoker):
    """Snowflake Cortex Executor"""

    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)
        self.connection: typing.Optional[snowflake.connector.SnowflakeConnection] = None
        self._setup_connection()

    def _setup_connection(self) -> None:
        """Setup Snowflake connection based on configuration"""
        config = self.prompty.model.configuration
        
        # Required connection parameters
        connection_params = {
            "account": config.get("account"),
            "user": config.get("user"),
            "warehouse": config.get("warehouse"),
            "database": config.get("database"),
            "schema": config.get("schema", "PUBLIC"),
        }

        # Authentication - support multiple methods
        if "password" in config:
            connection_params["password"] = config["password"]
        elif "private_key" in config:
            connection_params["private_key"] = config["private_key"]
        elif "private_key_path" in config:
            with open(config["private_key_path"], "rb") as key_file:
                connection_params["private_key"] = key_file.read()
        elif "authenticator" in config:
            connection_params["authenticator"] = config["authenticator"]
            if config["authenticator"] == "externalbrowser":
                # For SSO/browser-based auth
                pass
            elif "token" in config:
                connection_params["token"] = config["token"]

        # Optional connection parameters
        if "role" in config:
            connection_params["role"] = config["role"]
        if "session_parameters" in config:
            connection_params["session_parameters"] = config["session_parameters"]

        try:
            self.connection = snowflake.connector.connect(**connection_params)
        except Exception as e:
            raise ConnectionError(f"Failed to connect to Snowflake: {str(e)}")

    def _build_cortex_query(self, messages: List[Dict[str, Any]]) -> tuple[str, List[str]]:
        """Build CORTEX.COMPLETE SQL query from messages"""
        config = self.prompty.model.configuration
        params = self.prompty.model.parameters
        
        # Get model name (required)
        model = config.get("model", "llama3.1-8b")
        
        # Build the prompt from messages
        prompt_parts = []
        for message in messages:
            role = message.get("role", "user")
            content = message.get("content", "")
            
            if isinstance(content, str):
                prompt_parts.append(f"{role}: {content}")
            elif isinstance(content, list):
                # Handle multimodal content (text + images)
                text_content = ""
                for item in content:
                    if item.get("type") == "text":
                        text_content += item.get("text", "")
                    elif item.get("type") == "image_url":
                        # Snowflake Cortex doesn't support images in COMPLETE function
                        # Could be extended for vision models if/when supported
                        pass
                prompt_parts.append(f"{role}: {text_content}")
        
        prompt = "\\n".join(prompt_parts)
          # Build options object for CORTEX.COMPLETE
        options = {}
        
        # Map common parameters to Snowflake Cortex options
        if "temperature" in params:
            options["temperature"] = params["temperature"]
        if "max_tokens" in params:
            options["max_tokens"] = params["max_tokens"]
        if "top_p" in params:
            options["top_p"] = params["top_p"]
        if "stop" in params:
            options["stop"] = params["stop"]
        if "guardrails" in params:
            options["guardrails"] = params["guardrails"]
        if "response_format" in params:
            options["response_format"] = params["response_format"]
        
        # Add any snowflake-specific options
        snowflake_options = config.get("cortex_options", {})
        options.update(snowflake_options)
        
        # Build the SQL query
        if options:
            options_json = json.dumps(options)
            query = f"SELECT SNOWFLAKE.CORTEX.COMPLETE('{model}', %s, %s) as response"
            query_params = [prompt, options_json]
        else:
            query = f"SELECT SNOWFLAKE.CORTEX.COMPLETE('{model}', %s) as response"
            query_params = [prompt]
            
        return query, query_params

    def invoke(self, data: typing.Any) -> typing.Union[str, Dict[str, Any]]:
        """
        Invoke Snowflake Cortex COMPLETE function

        Parameters
        ----------
        data : Any
            The messages to send to Cortex (usually a list of message dicts)

        Returns
        -------
        Union[str, Dict[str, Any]]
            The response from Cortex
        """
        if not self.connection:
            raise RuntimeError("Snowflake connection not established")

        try:
            # Convert data to messages format if needed
            if isinstance(data, str):
                messages = [{"role": "user", "content": data}]
            elif isinstance(data, list):
                messages = data
            elif isinstance(data, dict) and "messages" in data:
                messages = data["messages"]
            else:
                messages = [{"role": "user", "content": str(data)}]

            # Build the Cortex query
            query, query_params = self._build_cortex_query(messages)
            
            # Execute the query
            with Tracer.start("SnowflakeCortex") as trace:
                trace("type", "LLM")
                trace("signature", "SnowflakeCortex.COMPLETE")
                trace("description", "Snowflake Cortex COMPLETE function execution")
                trace("inputs", {"query": query, "params": query_params})
                
                with self.connection.cursor(DictCursor) as cursor:
                    cursor.execute(query, query_params)
                    result = cursor.fetchone()
                    
                    trace("result", result)
                
                if result and isinstance(result, dict) and ("response" in result or "RESPONSE" in result):
                    # Handle both lowercase and uppercase response field names
                    response_text = result.get("response") or result.get("RESPONSE")
                      # Return in OpenAI-compatible format for consistency
                    return {
                        "choices": [
                            {
                                "message": {
                                    "role": "assistant",
                                    "content": response_text
                                },
                                "finish_reason": "stop",
                                "index": 0
                            }
                        ],
                        "model": self.prompty.model.configuration.get("model", "llama3.1-8b"),
                        "usage": {
                            # Snowflake doesn't return token usage in COMPLETE function
                            "prompt_tokens": 0,
                            "completion_tokens": 0,
                            "total_tokens": 0
                        }
                    }
                else:
                    raise RuntimeError("No response received from Snowflake Cortex")
                    
        except Exception as e:
            raise

    async def invoke_async(self, data: typing.Any) -> typing.Union[str, Dict[str, Any]]:
        """
        Async invoke - Snowflake connector doesn't support async, so we use sync

        Parameters
        ----------
        data : Any
            The messages to send to Cortex

        Returns
        -------
        Union[str, Dict[str, Any]]
            The response from Cortex
        """
        # Snowflake Python connector doesn't have native async support
        # For now, we'll use the sync version
        # In a production environment, you might want to use a thread pool
        return self.invoke(data)

    def __del__(self):
        """Clean up connection on destruction"""
        if self.connection:
            try:
                self.connection.close()
            except:
                pass
