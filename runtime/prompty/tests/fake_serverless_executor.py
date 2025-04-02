import json
import typing
from pathlib import Path

from azure.ai.inference.models import ChatCompletions, StreamingChatCompletionsUpdate

from prompty import Prompty
from prompty.core import AsyncPromptyStream, PromptyStream
from prompty.invoker import Invoker


## Azure Fake Executor
## To save on OpenAI Calls, will used known
## cached responses using invoker pattern
class FakeServerlessExecutor(Invoker):
    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)

        # resolve model
        self.resolve_model()

        # serverless configuration
        self.endpoint = self.prompty.model.connection["endpoint"]
        self.model = self.prompty.model.connection["model"]
        self.key = self.prompty.model.connection["key"]

        # api type
        self.api = self.prompty.model.api
        self.options = self.prompty.model.options

    def invoke(self, data: typing.Any) -> typing.Any:
        if self.prompty.file:
            if isinstance(self.prompty.file, str):
                self.prompty.file = Path(self.prompty.file).resolve().absolute()

            p = Path(self.prompty.file.parent) / f"{self.prompty.file.name}.execution.json"
            with open(p, encoding="utf-8") as f:
                j = f.read()

            if self.options.get("stream", False):
                items = json.loads(j)

                def generator():
                    for i in range(1, len(items)):
                        yield StreamingChatCompletionsUpdate(items[i])

                return PromptyStream("FakeAzureExecutor", generator())

            elif self.api == "chat":
                return ChatCompletions(json.loads(j))

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
        if self.prompty.file:
            if isinstance(self.prompty.file, str):
                self.prompty.file = Path(self.prompty.file).resolve().absolute()

            p = Path(self.prompty.file.parent) / f"{self.prompty.file.name}.execution.json"
            with open(p, encoding="utf-8") as f:
                j = f.read()

            if self.options.get("stream", False):
                items = json.loads(j)

                async def generator():
                    for i in range(1, len(items)):
                        yield StreamingChatCompletionsUpdate(items[i])

                return AsyncPromptyStream("FakeAzureExecutor", generator())

            elif self.api == "chat":
                return ChatCompletions(json.loads(j))

        return data
