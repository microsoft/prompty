import typing
from collections.abc import Iterator

import azure.identity
from azure.ai.inference import (
    ChatCompletionsClient,
    EmbeddingsClient,
)
from azure.ai.inference.aio import (
    ChatCompletionsClient as AsyncChatCompletionsClient,
)
from azure.ai.inference.aio import (
    EmbeddingsClient as AsyncEmbeddingsClient,
)
from azure.ai.inference.models import (
    AsyncStreamingChatCompletions,
    StreamingChatCompletions,
)
from azure.core.credentials import AzureKeyCredential

from .._version import VERSION
from ..core import AsyncPromptyStream, Prompty, PromptyStream
from ..invoker import Invoker, InvokerFactory
from ..tracer import Tracer


@InvokerFactory.register_executor("serverless")
class ServerlessExecutor(Invoker):
    """Azure OpenAI Executor"""

    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)
        self.kwargs = {key: value for key, value in self.prompty.model.connection.items() if key != "type"}

        self.endpoint = self.prompty.model.connection["endpoint"]
        self.model = self.prompty.model.connection["model"]

        # no key, use default credentials
        if "key" not in self.kwargs:
            self.credential: typing.Union[azure.identity.DefaultAzureCredential, AzureKeyCredential] = (
                azure.identity.DefaultAzureCredential(exclude_shared_token_cache_credential=True)
            )
        else:
            self.credential = AzureKeyCredential(self.prompty.model.connection["key"])

        # api type
        self.api = self.prompty.model.api

    def _response(self, response: typing.Any) -> typing.Any:
        # stream response
        if isinstance(response, Iterator):
            if isinstance(response, StreamingChatCompletions):
                stream: typing.Union[PromptyStream, AsyncPromptyStream] = PromptyStream("ServerlessExecutor", response)
                return stream
            elif isinstance(response, AsyncStreamingChatCompletions):
                stream = AsyncPromptyStream("ServerlessExecutor", response)
                return stream
            else:
                stream = PromptyStream("ServerlessExecutor", response)

            return stream
        else:
            return response

    def _sanitize_messages(self, data: typing.Any) -> list[dict[str, str]]:
        messages = data if isinstance(data, list) else [data]

        if self.prompty.template.strict:
            if not all([msg["nonce"] == self.prompty.template.nonce for msg in messages]):
                raise ValueError("Nonce mismatch in messages array (strict mode)")

        messages = [
            {
                **{"role": msg["role"], "content": msg["content"]},
                **({"name": msg["name"]} if "name" in msg else {}),
            }
            for msg in messages
        ]

        return messages

    def invoke(self, data: typing.Any) -> typing.Any:
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

        cargs = {
            "endpoint": self.endpoint,
            "credential": self.credential,
        }

        if self.api == "chat":
            with Tracer.start("ChatCompletionsClient") as trace:
                trace("type", "LLM")
                trace("signature", "azure.ai.inference.ChatCompletionsClient.ctor")
                trace("description", "Azure Unified Inference SDK Chat Completions Client")
                trace("inputs", cargs)
                client: typing.Any = ChatCompletionsClient(
                    user_agent=f"prompty/{VERSION}",
                    **cargs,
                )
                trace("result", client)

            with Tracer.start("complete") as trace:
                trace("type", "LLM")
                trace("signature", "azure.ai.inference.ChatCompletionsClient.complete")
                trace("description", "Azure Unified Inference SDK Chat Completions Client")
                eargs = {
                    "model": self.model,
                    "messages": self._sanitize_messages(data),
                    **self.prompty.model.options,
                }
                trace("inputs", eargs)
                r = client.complete(**eargs)
                trace("result", r)

            response = self._response(r)

        elif self.api == "completion":
            raise NotImplementedError("Serverless Completions API is not implemented yet")

        elif self.api == "embedding":
            with Tracer.start("EmbeddingsClient") as trace:
                trace("type", "LLM")
                trace("signature", "azure.ai.inference.EmbeddingsClient.ctor")
                trace("description", "Azure Unified Inference SDK Embeddings Client")
                trace("inputs", cargs)
                client = EmbeddingsClient(
                    user_agent=f"prompty/{VERSION}",
                    **cargs,
                )
                trace("result", client)

            with Tracer.start("complete") as trace:
                trace("type", "LLM")
                trace("signature", "azure.ai.inference.ChatCompletionsClient.complete")
                trace("description", "Azure Unified Inference SDK Chat Completions Client")
                eargs = {
                    "model": self.model,
                    "input": data if isinstance(data, list) else [data],
                    **self.prompty.model.options,
                }
                trace("inputs", eargs)
                r = client.complete(**eargs)
                trace("result", r)

            response = self._response(r)

        elif self.api == "image":
            raise NotImplementedError("Azure OpenAI Image API is not implemented yet")

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
        cargs = {
            "endpoint": self.endpoint,
            "credential": self.credential,
        }

        if self.api == "chat":
            with Tracer.start("ChatCompletionsClient") as trace:
                trace("type", "LLM")
                trace("signature", "azure.ai.inference.aio.ChatCompletionsClient.ctor")
                trace(
                    "description",
                    "Azure Unified Inference SDK Async Chat Completions Client",
                )
                trace("inputs", cargs)
                client: typing.Any = AsyncChatCompletionsClient(
                    user_agent=f"prompty/{VERSION}",
                    **cargs,
                )
                trace("result", client)

            with Tracer.start("complete") as trace:
                trace("type", "LLM")
                trace("signature", "azure.ai.inference.ChatCompletionsClient.complete")
                trace(
                    "description",
                    "Azure Unified Inference SDK Async Chat Completions Client",
                )
                eargs = {
                    "model": self.model,
                    "messages": self._sanitize_messages(data),
                    **self.prompty.model.options,
                }
                trace("inputs", eargs)
                r = await client.complete(**eargs)
                trace("result", r)

            response = self._response(r)

        elif self.api == "completion":
            raise NotImplementedError("Serverless Completions API is not implemented yet")

        elif self.api == "embedding":
            with Tracer.start("EmbeddingsClient") as trace:
                trace("type", "LLM")
                trace("signature", "azure.ai.inference.aio.EmbeddingsClient.ctor")
                trace("description", "Azure Unified Inference SDK Async Embeddings Client")
                trace("inputs", cargs)
                client = AsyncEmbeddingsClient(
                    user_agent=f"prompty/{VERSION}",
                    **cargs,
                )
                trace("result", client)

            with Tracer.start("complete") as trace:
                trace("type", "LLM")
                trace("signature", "azure.ai.inference.ChatCompletionsClient.complete")
                trace("description", "Azure Unified Inference SDK Chat Completions Client")
                eargs = {
                    "model": self.model,
                    "input": data if isinstance(data, list) else [data],
                    **self.prompty.model.options,
                }
                trace("inputs", eargs)
                r = await client.complete(**eargs)
                trace("result", r)

            response = self._response(r)

        elif self.api == "image":
            raise NotImplementedError("Azure OpenAI Image API is not implemented yet")

        return response
