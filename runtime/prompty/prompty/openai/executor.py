import importlib.metadata
from openai import OpenAI
from typing import Iterator
from ..core import Invoker, InvokerFactory, Prompty, PromptyStream

VERSION = importlib.metadata.version("prompty")


@InvokerFactory.register_executor("openai")
class AzureOpenAIExecutor(Invoker):
    """OpenAI Executor"""

    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)
        kwargs = {
            key: value
            for key, value in self.prompty.model.configuration.items()
            if key != "type"
        }

        self.client = OpenAI(
            default_headers={
                "User-Agent": f"prompty/{VERSION}",
                "x-ms-useragent": f"prompty/{VERSION}",
            },
            **kwargs,
        )

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
        if self.api == "chat":
            response = self.client.chat.completions.create(
                model=self.deployment,
                messages=data if isinstance(data, list) else [data],
                **self.parameters,
            )

        elif self.api == "completion":
            response = self.client.completions.create(
                prompt=data.item,
                model=self.deployment,
                **self.parameters,
            )

        elif self.api == "embedding":
            response = self.client.embeddings.create(
                input=data if isinstance(data, list) else [data],
                model=self.deployment,
                **self.parameters,
            )

        elif self.api == "image":
            raise NotImplementedError("OpenAI Image API is not implemented yet")

        # stream response
        if isinstance(response, Iterator):
            return PromptyStream("OpenAIExecutor", response)
        else:
            return response
