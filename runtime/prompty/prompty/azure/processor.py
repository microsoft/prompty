from typing import AsyncIterator, Iterator
from openai.types.completion import Completion
from openai.types.images_response import ImagesResponse
from openai.types.chat.chat_completion import ChatCompletion
from ..core import AsyncPromptyStream, Prompty, PromptyStream, ToolCall
from ..invoker import Invoker, InvokerFactory
from openai.types.create_embedding_response import CreateEmbeddingResponse


@InvokerFactory.register_processor("azure")
@InvokerFactory.register_processor("azure_openai")
class AzureOpenAIProcessor(Invoker):
    """Azure OpenAI Processor"""

    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)

    def invoke(self, data: any) -> any:
        """Invoke the OpenAI/Azure API

        Parameters
        ----------
        data : any
            The data to send to the OpenAI/Azure API

        Returns
        -------
        any
            The response from the OpenAI/Azure API
        """
        if isinstance(data, ChatCompletion):
            response = data.choices[0].message
            # tool calls available in response
            if response.tool_calls:
                return [
                    ToolCall(
                        id=tool_call.id,
                        name=tool_call.function.name,
                        arguments=tool_call.function.arguments,
                    )
                    for tool_call in response.tool_calls
                ]
            else:
                return response.content

        elif isinstance(data, Completion):
            return data.choices[0].text
        elif isinstance(data, CreateEmbeddingResponse):
            if len(data.data) == 0:
                raise ValueError("Invalid data")
            elif len(data.data) == 1:
                return data.data[0].embedding
            else:
                return [item.embedding for item in data.data]
        elif isinstance(data, ImagesResponse):
            self.prompty.model.parameters
            item: ImagesResponse = data

            if len(data.data) == 0:
                raise ValueError("Invalid data")
            elif len(data.data) == 1:
                return data.data[0].url if item.data[0].url else item.data[0].b64_json
            else:
                return [item.url if item.url else item.b64_json for item in data.data]

        elif isinstance(data, Iterator):

            def generator():
                for chunk in data:
                    if (
                        len(chunk.choices) == 1
                        and chunk.choices[0].delta.content != None
                    ):
                        content = chunk.choices[0].delta.content
                        yield content

            return PromptyStream("AzureOpenAIProcessor", generator())
        else:
            return data

    async def invoke_async(self, data: str) -> str:
        """Invoke the Prompty Chat Parser (Async)

        Parameters
        ----------
        data : str
            The data to parse

        Returns
        -------
        str
            The parsed data
        """
        if isinstance(data, ChatCompletion):
            response = data.choices[0].message
            # tool calls available in response
            if response.tool_calls:
                return [
                    ToolCall(
                        id=tool_call.id,
                        name=tool_call.function.name,
                        arguments=tool_call.function.arguments,
                    )
                    for tool_call in response.tool_calls
                ]
            else:
                return response.content

        elif isinstance(data, Completion):
            return data.choices[0].text
        elif isinstance(data, CreateEmbeddingResponse):
            if len(data.data) == 0:
                raise ValueError("Invalid data")
            elif len(data.data) == 1:
                return data.data[0].embedding
            else:
                return [item.embedding for item in data.data]
        elif isinstance(data, ImagesResponse):
            self.prompty.model.parameters
            item: ImagesResponse = data

            if len(data.data) == 0:
                raise ValueError("Invalid data")
            elif len(data.data) == 1:
                return data.data[0].url if item.data[0].url else item.data[0].b64_json
            else:
                return [item.url if item.url else item.b64_json for item in data.data]

        elif isinstance(data, AsyncIterator):

            async def generator():
                async for chunk in data:
                    if (
                        len(chunk.choices) == 1
                        and chunk.choices[0].delta.content != None
                    ):
                        content = chunk.choices[0].delta.content
                        yield content

            return AsyncPromptyStream("AsyncAzureOpenAIProcessor", generator())
        else:
            return data
