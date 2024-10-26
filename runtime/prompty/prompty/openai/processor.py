from typing import Iterator
from openai.types.completion import Completion
from openai.types.chat.chat_completion import ChatCompletion
from ..invoker import Invoker, InvokerFactory
from ..core import Prompty, PromptyStream, ToolCall
from openai.types.create_embedding_response import CreateEmbeddingResponse


@InvokerFactory.register_processor("openai")
class OpenAIProcessor(Invoker):
    """OpenAI Processor"""

    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)

    def invoke(self, data: any) -> any:
        """Invoke the OpenAI API

        Parameters
        ----------
        data : any
            The data to send to the OpenAI API

        Returns
        -------
        any
            The response from the OpenAI API
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
        elif isinstance(data, Iterator):

            def generator():
                for chunk in data:
                    if (
                        len(chunk.choices) == 1
                        and chunk.choices[0].delta.content != None
                    ):
                        content = chunk.choices[0].delta.content
                        yield content

            return PromptyStream("OpenAIProcessor", generator())
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
        return self.invoke(data)
