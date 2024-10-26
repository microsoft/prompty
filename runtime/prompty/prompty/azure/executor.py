import azure.identity
import importlib.metadata
from typing import AsyncIterator, Iterator
from openai import AzureOpenAI, AsyncAzureOpenAI

from prompty.tracer import Tracer
from ..core import AsyncPromptyStream, Prompty, PromptyStream
from ..invoker import Invoker, InvokerFactory

VERSION = importlib.metadata.version("prompty")


@InvokerFactory.register_executor("azure")
@InvokerFactory.register_executor("azure_openai")
class AzureOpenAIExecutor(Invoker):
    """Azure OpenAI Executor"""

    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)
        self.kwargs = {
            key: value
            for key, value in self.prompty.model.configuration.items()
            if key != "type"
        }

        # no key, use default credentials
        if "api_key" not in self.kwargs:
            # managed identity if client id
            if "client_id" in self.kwargs:
                default_credential = azure.identity.ManagedIdentityCredential(
                    client_id=self.kwargs.pop("client_id"),
                )
            # default credential
            else:
                default_credential = azure.identity.DefaultAzureCredential(
                    exclude_shared_token_cache_credential=True
                )

            self.kwargs["azure_ad_token_provider"] = (
                azure.identity.get_bearer_token_provider(
                    default_credential, "https://cognitiveservices.azure.com/.default"
                )
            )

        self.api = self.prompty.model.api
        self.deployment = self.prompty.model.configuration["azure_deployment"]
        self.parameters = self.prompty.model.parameters

    def invoke(self, data: any) -> any:
        """Invoke the Azure OpenAI API

        Parameters
        ----------
        data : any
            The data to send to the Azure OpenAI API

        Returns
        -------
        any
            The response from the Azure OpenAI API
        """

        with Tracer.start("AzureOpenAI") as trace:
            trace("type", "LLM")
            trace("signature", "AzureOpenAI.ctor")
            trace("description", "Azure OpenAI Constructor")
            trace("inputs", self.kwargs)
            client = AzureOpenAI(
                default_headers={
                    "User-Agent": f"prompty/{VERSION}",
                    "x-ms-useragent": f"prompty/{VERSION}",
                },
                **self.kwargs,
            )
            trace("result", client)

        with Tracer.start("create") as trace:
            trace("type", "LLM")
            trace("description", "Azure OpenAI Client")

            if self.api == "chat":
                trace("signature", "AzureOpenAI.chat.completions.create")
                args = {
                    "model": self.deployment,
                    "messages": data if isinstance(data, list) else [data],
                    **self.parameters,
                }
                trace("inputs", args)
                response = client.chat.completions.create(**args)
                trace("result", response)

            elif self.api == "completion":
                trace("signature", "AzureOpenAI.completions.create")
                args = {
                    "prompt": data,
                    "model": self.deployment,
                    **self.parameters,
                }
                trace("inputs", args)
                response = client.completions.create(**args)
                trace("result", response)

            elif self.api == "embedding":
                trace("signature", "AzureOpenAI.embeddings.create")
                args = {
                    "input": data if isinstance(data, list) else [data],
                    "model": self.deployment,
                    **self.parameters,
                }
                trace("inputs", args)
                response = client.embeddings.create(**args)
                trace("result", response)

            elif self.api == "image":
                trace("signature", "AzureOpenAI.images.generate")
                args = {
                    "prompt": data,
                    "model": self.deployment,
                    **self.parameters,
                }
                trace("inputs", args)
                response = client.images.generate.create(**args)
                trace("result", response)

        # stream response
        if isinstance(response, Iterator):
            if self.api == "chat":
                # TODO: handle the case where there might be no usage in the stream
                return PromptyStream("AzureOpenAIExecutor", response)
            else:
                return PromptyStream("AzureOpenAIExecutor", response)
        else:
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
        with Tracer.start("AzureOpenAIAsync") as trace:
            trace("type", "LLM")
            trace("signature", "AzureOpenAIAsync.ctor")
            trace("description", "Async Azure OpenAI Constructor")
            trace("inputs", self.kwargs)
            client = AsyncAzureOpenAI(
                default_headers={
                    "User-Agent": f"prompty/{VERSION}",
                    "x-ms-useragent": f"prompty/{VERSION}",
                },
                **self.kwargs,
            )
            trace("result", client)

        with Tracer.start("create") as trace:
            trace("type", "LLM")
            trace("description", "Azure OpenAI Client")

            if self.api == "chat":
                trace("signature", "AzureOpenAIAsync.chat.completions.create")
                args = {
                    "model": self.deployment,
                    "messages": data if isinstance(data, list) else [data],
                    **self.parameters,
                }
                trace("inputs", args)
                response = await client.chat.completions.create(**args)
                trace("result", response)

            elif self.api == "completion":
                trace("signature", "AzureOpenAIAsync.completions.create")
                args = {
                    "prompt": data,
                    "model": self.deployment,
                    **self.parameters,
                }
                trace("inputs", args)
                response = await client.completions.create(**args)
                trace("result", response)

            elif self.api == "embedding":
                trace("signature", "AzureOpenAIAsync.embeddings.create")
                args = {
                    "input": data if isinstance(data, list) else [data],
                    "model": self.deployment,
                    **self.parameters,
                }
                trace("inputs", args)
                response = await client.embeddings.create(**args)
                trace("result", response)

            elif self.api == "image":
                trace("signature", "AzureOpenAIAsync.images.generate")
                args = {
                    "prompt": data,
                    "model": self.deployment,
                    **self.parameters,
                }
                trace("inputs", args)
                response = await client.images.generate.create(**args)
                trace("result", response)

        # stream response
        if isinstance(response, AsyncIterator):
            if self.api == "chat":
                # TODO: handle the case where there might be no usage in the stream
                return AsyncPromptyStream("AzureOpenAIExecutorAsync", response)
            else:
                return AsyncPromptyStream("AzureOpenAIExecutorAsync", response)
        else:
            return response
