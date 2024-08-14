import importlib.metadata
from typing import Iterator
from azure.core.credentials import AzureKeyCredential
from azure.ai.inference import (
    ChatCompletionsClient,
    EmbeddingsClient,
)
from azure.ai.inference.models import (
    StreamingChatCompletions,
    AsyncStreamingChatCompletions,
)
from ..core import Invoker, InvokerFactory, Prompty, PromptyStream, AsyncPromptyStream

VERSION = importlib.metadata.version("prompty")


@InvokerFactory.register_executor("serverless")
class ServerlessExecutor(Invoker):
    """Azure OpenAI Executor"""

    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)

        # serverless configuration
        self.endpoint = self.prompty.model.configuration["endpoint"]
        self.model = self.prompty.model.configuration["model"]
        self.key = self.prompty.model.configuration["key"]

        # api type
        self.api = self.prompty.model.api

    def invoke(self, data: any) -> any:
        """Invoke the Serverless SDK

        Parameters
        ----------
        data : any
            The data to send to the Serverless SDK

        Returns
        -------
        any
            The response from the Serverless SDK
        """
        if self.api == "chat":
            response = ChatCompletionsClient(
                endpoint=self.endpoint,
                credential=AzureKeyCredential(self.key),
                user_agent=f"prompty/{VERSION}"
            ).complete(
                model=self.model,
                messages=data if isinstance(data, list) else [data],
                **self.prompty.model.parameters,
            )

        elif self.api == "completion":
            raise NotImplementedError(
                "Serverless Completions API is not implemented yet"
            )

        elif self.api == "embedding":
            response = EmbeddingsClient(
                endpoint=self.endpoint,
                credential=AzureKeyCredential(self.key),
                user_agent=f"prompty/{VERSION}",
            ).complete(
                model=self.model,
                input=data if isinstance(data, list) else [data],
                **self.prompty.model.parameters,
            )

        elif self.api == "image":
            raise NotImplementedError("Azure OpenAI Image API is not implemented yet")

        # stream response
        if isinstance(response, Iterator):
            if isinstance(response, StreamingChatCompletions):
                return PromptyStream("ServerlessExecutor", response)
            elif isinstance(response, AsyncStreamingChatCompletions):
                return AsyncPromptyStream("ServerlessExecutor", response)
            return PromptyStream("ServerlessExecutor", response)
        else:

            return response
