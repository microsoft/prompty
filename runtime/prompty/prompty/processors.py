from pydantic import BaseModel
from openai.types.completion import Completion
from .core import Invoker, InvokerFactory, Prompty
from openai.types.chat.chat_completion import ChatCompletion
from openai.types.create_embedding_response import CreateEmbeddingResponse



class ToolCall(BaseModel):
    id: str
    name: str
    arguments: str


@InvokerFactory.register_processor("openai")
@InvokerFactory.register_processor("azure")
@InvokerFactory.register_processor("azure_openai")
class OpenAIProcessor(Invoker):
    def __init__(self, prompty: Prompty) -> None:
        self.prompty = prompty

    def invoke(self, data: any) -> any:

        assert (
            isinstance(data, ChatCompletion)
            or isinstance(data, Completion)
            or isinstance(data, CreateEmbeddingResponse)
        )
        if isinstance(data, ChatCompletion):
            # TODO: Check for streaming response
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
        else:
            raise ValueError("Invalid data type")
