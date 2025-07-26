import json
import typing
from pathlib import Path

from prompty import Prompty
from prompty.core import AsyncPromptyStream, PromptyStream
from prompty.invoker import Invoker


## Snowflake Fake Executor
## To save on Snowflake Cortex calls, will use known
## cached responses using invoker pattern
class FakeSnowflakeExecutor(Invoker):
    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)
        self.api = self.prompty.model.api
        self.model = self.prompty.model.configuration.get("model", "llama3.1-8b")
        self.parameters = self.prompty.model.parameters

    def invoke(self, data: typing.Any) -> typing.Any:
        if self.prompty.file:
            if isinstance(self.prompty.file, str):
                self.prompty.file = Path(self.prompty.file).resolve().absolute()
                
            p = (
                Path(self.prompty.file.parent)
                / f"{self.prompty.file.name}.execution.json"
            )
            with open(p, encoding="utf-8") as f:
                j = f.read()

            if self.parameters.get("stream", False):
                items = json.loads(j)

                def generator():
                    for i in range(1, len(items)):
                        # Snowflake Cortex doesn't support streaming, but simulate for tests
                        yield {
                            "choices": [{
                                "delta": {
                                    "content": items[i].get("content", ""),
                                    "role": "assistant"
                                },
                                "finish_reason": None if i < len(items) - 1 else "stop",
                                "index": 0
                            }]
                        }

                return PromptyStream("FakeSnowflakeExecutor", generator())

            elif self.api == "chat":
                # Return Snowflake Cortex compatible response format
                response_data = json.loads(j)
                return response_data
            elif self.api == "completion":
                # Handle completion API
                response_data = json.loads(j)
                return response_data
            elif self.api == "embedding":
                # Snowflake Cortex embedding simulation (future feature)
                if not isinstance(data, list):
                    d = [data]
                else:
                    d = data

                n = "-".join([s.replace(" ", "_") for s in d if isinstance(s, str)])
                p = Path(__file__).parent / f"{n}.embedding.json"
                if p.exists():
                    with open(p, encoding="utf-8") as f:
                        response = json.loads(f.read())
                        return response
                else:
                    # Return mock embedding response
                    return {
                        "data": [{
                            "object": "embedding",
                            "embedding": [0.1] * 1536,  # Mock embedding vector
                            "index": 0
                        }],
                        "model": self.model,
                        "object": "list",
                        "usage": {
                            "prompt_tokens": 10,
                            "total_tokens": 10
                        }
                    }

        return data

    async def invoke_async(self, data: str) -> typing.Any:
        """Invoke the Snowflake Cortex Fake Executor (Async)

        Parameters
        ----------
        data : str
            The data to parse

        Returns
        -------
        typing.Any
            The parsed data
        """
        if self.prompty.file:
            if isinstance(self.prompty.file, str):
                self.prompty.file = Path(self.prompty.file).resolve().absolute()
            p = (
                Path(self.prompty.file.parent)
                / f"{self.prompty.file.name}.execution.json"
            )
            with open(p, encoding="utf-8") as f:
                j = f.read()

            if self.parameters.get("stream", False):
                items = json.loads(j)

                async def generator():
                    for i in range(1, len(items)):
                        yield {
                            "choices": [{
                                "delta": {
                                    "content": items[i].get("content", ""),
                                    "role": "assistant"
                                },
                                "finish_reason": None if i < len(items) - 1 else "stop",
                                "index": 0
                            }]
                        }

                return AsyncPromptyStream("FakeSnowflakeExecutor", generator())

            elif self.api == "chat":
                response_data = json.loads(j)
                return response_data
            elif self.api == "completion":
                response_data = json.loads(j)
                return response_data
            elif self.api == "embedding":
                if not isinstance(data, list):
                    d = [data]
                else:
                    d = data

                n = "-".join([s.replace(" ", "_") for s in d if isinstance(s, str)])
                p = Path(__file__).parent / f"{n}.embedding.json"
                if p.exists():
                    with open(p, encoding="utf-8") as f:
                        response = json.loads(f.read())
                        return response
                else:
                    return {
                        "data": [{
                            "object": "embedding",
                            "embedding": [0.1] * 1536,
                            "index": 0
                        }],
                        "model": self.model,
                        "object": "list",
                        "usage": {
                            "prompt_tokens": 10,
                            "total_tokens": 10
                        }
                    }

        return data
