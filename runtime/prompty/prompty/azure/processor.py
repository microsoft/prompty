import json
import typing
from collections.abc import AsyncIterator, Iterator

from openai.types.chat.chat_completion import ChatCompletion
from openai.types.completion import Completion
from openai.types.create_embedding_response import CreateEmbeddingResponse
from openai.types.images_response import ImagesResponse

from ..core import AsyncPromptyStream, Prompty, PromptyStream, ToolCall
from ..invoker import Invoker, InvokerFactory


@InvokerFactory.register_processor("azure")
@InvokerFactory.register_processor("azure_openai")
@InvokerFactory.register_processor("azure_beta")
@InvokerFactory.register_processor("azure_openai_beta")
class AzureOpenAIProcessor(Invoker):
    """Azure OpenAI Processor"""

    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)

    def invoke(self, data: typing.Any) -> typing.Union[
        str,
        list[typing.Union[str, None]],
        list[ToolCall],
        list[float],
        list[list[float]],
        PromptyStream,
        None,
    ]:
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
                if (
                    len(self.prompty.outputs) > 0
                    and response.content is not None
                    and isinstance(response.content, str)
                    and len(response.content) > 0
                ):
                    try:
                        return json.loads(response.content)
                    except json.JSONDecodeError:
                        # If the response is not JSON, return the content as is
                        return response.content
                else:
                    # add response to thread if it exists
                    thread = self.prompty.get_input("thread")
                    if thread is not None and isinstance(thread.value, list):
                        thread.value.append({"role": "assistant", "content": response.content})

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
            item: ImagesResponse = data

            if item.data is None or len(item.data) == 0:
                raise ValueError("Invalid data")
            elif len(item.data) == 1:
                return item.data[0].url if item.data[0].url else item.data[0].b64_json
            else:
                return [i.url if i.url else i.b64_json for i in item.data]

        elif isinstance(data, Iterator):

            def generator():
                for chunk in data:
                    if len(chunk.choices) == 1 and chunk.choices[0].delta.content is not None:
                        content = chunk.choices[0].delta.content
                        yield content

            return PromptyStream("AzureOpenAIProcessor", generator())
        else:
            return data

    async def invoke_async(self, data: str) -> typing.Any:
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
                if (
                    len(self.prompty.outputs) > 0
                    and response.content is not None
                    and isinstance(response.content, str)
                    and len(response.content) > 0
                ):
                    try:
                        return json.loads(response.content)
                    except json.JSONDecodeError:
                        # If the response is not JSON, return the content as is
                        return response.content
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

            item: ImagesResponse = data

            if len(data.data) == 0:
                raise ValueError("Invalid data")
            elif len(data.data) == 1:
                return data.data[0].url if item.data[0].url else item.data[0].b64_json
            else:
                return [str(item.url) if item.url else item.b64_json for item in data.data]

        elif isinstance(data, AsyncIterator):

            async def generator():
                async for chunk in data:
                    if len(chunk.choices) == 1 and chunk.choices[0].delta.content is not None:
                        content = chunk.choices[0].delta.content
                        yield content

            return AsyncPromptyStream("AsyncAzureOpenAIProcessor", generator())
        else:
            return data
