import typing
from collections.abc import Iterator

from openai import OpenAI

from prompty.tracer import Tracer

from .._version import VERSION
from ..core import Prompty, PromptyStream
from ..invoker import Invoker, InvokerFactory


@InvokerFactory.register_executor("openai")
class OpenAIExecutor(Invoker):
    """OpenAI Executor"""

    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)
        self.kwargs = {
            key: value for key, value in self.prompty.model.connection.items() if key != "type" and key != "name"
        }

        self.api = self.prompty.model.api
        self.options = self.prompty.model.options
        self.model = self.prompty.model.connection["name"]
        self.deployment = self.prompty.model.connection["deployment"]

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

        response = None
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
                    "model": self.model,
                    "messages": self._sanitize_messages(data),
                    **self.options,
                }
                trace("inputs", args)
                response = client.chat.completions.create(**args)

            elif self.api == "completion":
                trace("signature", "OpenAI.completions.create")
                args = {
                    "prompt": data.item,
                    "model": self.deployment,
                    **self.options,
                }
                trace("inputs", args)
                response = client.completions.create(**args)

            elif self.api == "embedding":
                trace("signature", "OpenAI.embeddings.create")
                args = {
                    "input": data if isinstance(data, list) else [data],
                    "model": self.deployment,
                    **self.options,
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
