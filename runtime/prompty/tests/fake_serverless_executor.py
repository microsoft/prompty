import json
from pathlib import Path
from prompty import Invoker, Prompty
from prompty.core import AsyncPromptyStream, PromptyStream
from azure.ai.inference.models import ChatCompletions, StreamingChatCompletionsUpdate


## Azure Fake Executor
## To save on OpenAI Calls, will used known
## cached responses using invoker pattern
class FakeServerlessExecutor(Invoker):
    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)

        # serverless configuration
        self.endpoint = self.prompty.model.configuration["endpoint"]
        self.model = self.prompty.model.configuration["model"]
        self.key = self.prompty.model.configuration["key"]

        # api type
        self.api = self.prompty.model.api
        self.parameters = self.prompty.model.parameters

    def invoke(self, data: any) -> any:
        if self.prompty.file:
            p = (
                Path(self.prompty.file.parent)
                / f"{self.prompty.file.name}.execution.json"
            )
            with open(p, "r", encoding="utf-8") as f:
                j = f.read()

            if self.parameters.get("stream", False):
                items = json.loads(j)

                def generator():
                    for i in range(1, len(items)):
                        yield StreamingChatCompletionsUpdate(items[i])

                return PromptyStream("FakeAzureExecutor", generator())

            elif self.api == "chat":
                return ChatCompletions(json.loads(j))

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
        if self.prompty.file:
            p = (
                Path(self.prompty.file.parent)
                / f"{self.prompty.file.name}.execution.json"
            )
            with open(p, "r", encoding="utf-8") as f:
                j = f.read()

            if self.parameters.get("stream", False):
                items = json.loads(j)

                async def generator():
                    for i in range(1, len(items)):
                        yield StreamingChatCompletionsUpdate(items[i])

                return AsyncPromptyStream("FakeAzureExecutor", generator())

            elif self.api == "chat":
                return ChatCompletions(json.loads(j))

        return data
