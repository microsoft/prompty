import typing
from typing import Any, Dict, List, Union

from ..core import Prompty, ToolCall
from ..invoker import Invoker, InvokerFactory


@InvokerFactory.register_processor("snowflake")
@InvokerFactory.register_processor("snowflake_cortex")
class SnowflakeCortexProcessor(Invoker):
    """Snowflake Cortex Processor"""

    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)

    def invoke(self, data: typing.Any) -> typing.Union[
        str,
        List[typing.Union[str, None]],
        List[ToolCall],
        List[float],
        List[List[float]],
        None,
    ]:
        """
        Process Snowflake Cortex response

        Parameters
        ----------
        data : Any
            The response from Snowflake Cortex executor

        Returns
        -------
        Union[str, List[Union[str, None]], List[ToolCall], List[float], List[List[float]], None]
            The processed response based on model API type and response configuration
        """
        if data is None:
            return None

        # Handle different response formats based on API type
        api = self.prompty.model.api
        response_mode = self.prompty.model.response

        if api == "chat":
            return self._process_chat_response(data, response_mode)
        elif api == "completion":
            return self._process_completion_response(data, response_mode)
        elif api == "embedding":
            return self._process_embedding_response(data)
        else:
            # Default to returning the content as string
            return self._extract_content(data)

    def _process_chat_response(self, data: Dict[str, Any], response_mode: str) -> Union[str, List[str]]:
        """Process chat completion response"""
        if "choices" in data and len(data["choices"]) > 0:
            if response_mode == "first":
                # Return just the content of the first choice
                choice = data["choices"][0]
                if "message" in choice and "content" in choice["message"]:
                    return choice["message"]["content"]
                return ""
            elif response_mode == "all":
                # Return all choices as a list
                results = []
                for choice in data["choices"]:
                    if "message" in choice and "content" in choice["message"]:
                        results.append(choice["message"]["content"])
                    else:
                        results.append("")
                return results
        
        # Fallback: try to extract content directly
        return self._extract_content(data)

    def _process_completion_response(self, data: Dict[str, Any], response_mode: str) -> Union[str, List[str]]:
        """Process text completion response"""
        if "choices" in data and len(data["choices"]) > 0:
            if response_mode == "first":
                # Return just the text of the first choice
                choice = data["choices"][0]
                if "text" in choice:
                    return choice["text"]
                elif "message" in choice and "content" in choice["message"]:
                    return choice["message"]["content"]
                return ""
            elif response_mode == "all":
                # Return all choices as a list
                results = []
                for choice in data["choices"]:
                    if "text" in choice:
                        results.append(choice["text"])
                    elif "message" in choice and "content" in choice["message"]:
                        results.append(choice["message"]["content"])
                    else:
                        results.append("")
                return results
        
        # Fallback: try to extract content directly
        return self._extract_content(data)

    def _process_embedding_response(self, data: Dict[str, Any]) -> List[float]:
        """Process embedding response"""
        # Snowflake Cortex COMPLETE doesn't directly support embeddings
        # This would be for future embedding functions like CORTEX.EMBED_TEXT
        if "data" in data and len(data["data"]) > 0:
            if "embedding" in data["data"][0]:
                return data["data"][0]["embedding"]
        
        # If it's a direct embedding array
        if isinstance(data, list) and len(data) > 0 and isinstance(data[0], (int, float)):
            return data
            
        return []

    def _extract_content(self, data: Any) -> str:
        """Extract content from various response formats"""
        if isinstance(data, str):
            return data
        elif isinstance(data, dict):
            # Try common content keys
            for key in ["content", "text", "response", "result", "output"]:
                if key in data:
                    content = data[key]
                    if isinstance(content, str):
                        return content
                    elif isinstance(content, dict) and "content" in content:
                        return str(content["content"])
            
            # If it's a structured response, try to get the message content
            if "choices" in data and len(data["choices"]) > 0:
                choice = data["choices"][0]
                if "message" in choice and "content" in choice["message"]:
                    return choice["message"]["content"]
                elif "text" in choice:
                    return choice["text"]
            
            # Last resort: convert the whole thing to string
            return str(data)
        else:
            return str(data)

    async def invoke_async(self, data: typing.Any) -> typing.Union[
        str,
        List[typing.Union[str, None]],
        List[ToolCall],
        List[float],
        List[List[float]],
        None,
    ]:
        """
        Async process Snowflake Cortex response

        Parameters
        ----------
        data : Any
            The response from Snowflake Cortex executor

        Returns
        -------
        Union[str, List[Union[str, None]], List[ToolCall], List[float], List[List[float]], None]
            The processed response
        """
        # Processing is CPU-bound and doesn't require async
        return self.invoke(data)
