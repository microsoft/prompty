from pathlib import Path
from prompty import Invoker, Prompty, InvokerFactory
from openai.types.chat.chat_completion import ChatCompletion
from openai.types.create_embedding_response import CreateEmbeddingResponse
from pydantic_core import from_json


@InvokerFactory.register_renderer("fake")
@InvokerFactory.register_parser("fake.chat")
@InvokerFactory.register_executor("fake")
@InvokerFactory.register_processor("fake")
class FakeInvoker(Invoker):
    def __init__(self, prompty: Prompty) -> None:
        self.prompty = prompty

    def invoke(self, data: any) -> any:
        return data


## Azure Fake Executor
## To save on OpenAI Calls, will used known
## cached responses using invoker pattern
@InvokerFactory.register_executor("azure")
@InvokerFactory.register_executor("azure_openai")
class FakeAzureExecutor(Invoker):
    def __init__(self, prompty: Prompty) -> None:
        self.prompty = prompty
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

            if self.api == "chat":
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
