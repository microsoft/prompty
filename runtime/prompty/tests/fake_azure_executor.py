import json
from pathlib import Path
from prompty import Prompty
from prompty.invoker import Invoker
from prompty.core import AsyncPromptyStream, PromptyStream
from openai.types.chat import ChatCompletionChunk
from openai.types.chat.chat_completion import ChatCompletion
from openai.types.create_embedding_response import CreateEmbeddingResponse


## Azure Fake Executor
## To save on OpenAI Calls, will used known
## cached responses using invoker pattern
class FakeAzureExecutor(Invoker):
    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)
        self.api = self.prompty.model.api
        self.deployment = self.prompty.model.configuration["azure_deployment"]
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
                        yield ChatCompletionChunk.model_validate(items[i])

                return PromptyStream("FakeAzureExecutor", generator())

            elif self.api == "chat":
                return ChatCompletion.model_validate_json(j)
            elif self.api == "embedding":
                return CreateEmbeddingResponse.model_validate_json(j)

        elif self.api == "embedding":
            if not isinstance(data, list):
                d = [data]
            else:
                d = data

            n = "-".join([s.replace(" ", "_") for s in d if isinstance(s, str)])
            p = Path(__file__).parent / f"{n}.embedding.json"
            with open(p, "r", encoding="utf-8") as f:
                response = CreateEmbeddingResponse.model_validate_json(f.read())
                return response

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
                        yield ChatCompletionChunk.model_validate(items[i])

                return AsyncPromptyStream("FakeAzureExecutor", generator())

            elif self.api == "chat":
                return ChatCompletion.model_validate_json(j)
            elif self.api == "embedding":
                return CreateEmbeddingResponse.model_validate_json(j)

        elif self.api == "embedding":
            if not isinstance(data, list):
                d = [data]
            else:
                d = data

            n = "-".join([s.replace(" ", "_") for s in d if isinstance(s, str)])
            p = Path(__file__).parent / f"{n}.embedding.json"
            with open(p, "r", encoding="utf-8") as f:
                response = CreateEmbeddingResponse.model_validate_json(f.read())
                return response

        return data
