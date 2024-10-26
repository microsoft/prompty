import importlib.metadata
from openai import OpenAI
from typing import Iterator

from prompty.tracer import Tracer
from ..core import Prompty, PromptyStream
from ..invoker import Invoker, InvokerFactory

VERSION = importlib.metadata.version("prompty")


@InvokerFactory.register_executor("openai")
class OpenAIExecutor(Invoker):
    """OpenAI Executor"""

    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)
        self.kwargs = {
            key: value
            for key, value in self.prompty.model.configuration.items()
            if key != "type"
        }

        self.api = self.prompty.model.api
        self.deployment = self.prompty.model.configuration["azure_deployment"]
        self.parameters = self.prompty.model.parameters

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
        with Tracer.start("OpenAI") as trace:
            trace("type", "LLM")
            trace("signature", "OpenAI.ctor")
            trace("description", "OpenAI Constructor")
            trace("inputs", self.kwargs)
            client = OpenAI(
                default_headers={
                    "User-Agent": f"prompty/{VERSION}",
                    "x-ms-useragent": f"prompty/{VERSION}",
                },
                **self.kwargs,
            )
            trace("result", client)

        with Tracer.start("create") as trace:
            trace("type", "LLM")
            trace("description", "OpenAI Prompty Execution Invoker")

            if self.api == "chat":
                trace("signature", "OpenAI.chat.completions.create")
                args = {
                    "model": self.deployment,
                    "messages": data if isinstance(data, list) else [data],
                    **self.parameters,
                }
                trace("inputs", args)
                response = client.chat.completions.create(**args)

            elif self.api == "completion":
                trace("signature", "OpenAI.completions.create")
                args = {
                    "prompt": data.item,
                    "model": self.deployment,
                    **self.parameters,
                }
                trace("inputs", args)
                response = client.completions.create(**args)

            elif self.api == "embedding":
                trace("signature", "OpenAI.embeddings.create")
                args = {
                    "input": data if isinstance(data, list) else [data],
                    "model": self.deployment,
                    **self.parameters,
                }
                trace("inputs", args)
                response = client.embeddings.create(**args)

            elif self.api == "image":
                raise NotImplementedError("OpenAI Image API is not implemented yet")

            # stream response
            if isinstance(response, Iterator):
                stream = PromptyStream("AzureOpenAIExecutor", response)
                trace("result", stream)
                return stream
            else:
                trace("result", response)
                return response

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
