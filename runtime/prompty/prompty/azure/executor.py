import json
import typing
from collections.abc import AsyncIterator, Iterator

import azure.identity
from openai import APIResponse, AsyncAzureOpenAI, AzureOpenAI
from openai.types.chat.chat_completion import ChatCompletion

from prompty.tracer import Tracer

from .._version import VERSION
from ..common import convert_function_tools, convert_output_props
from ..core import AsyncPromptyStream, Prompty, PromptyStream
from ..invoker import Invoker, InvokerFactory


@InvokerFactory.register_executor("azure")
@InvokerFactory.register_executor("azure_openai")
class AzureOpenAIExecutor(Invoker):
    """Azure OpenAI Executor"""

    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)

        # resolve model connection and options
        self.resolve_model()

        self.kwargs = {key: value for key, value in self.prompty.model.connection.items() if key != "type"}

        # no key, use default credentials
        if "api_key" not in self.kwargs:
            # managed identity if client id
            if "client_id" in self.kwargs:
                default_credential: typing.Union[
                    azure.identity.ManagedIdentityCredential,
                    azure.identity.DefaultAzureCredential,
                ] = azure.identity.ManagedIdentityCredential(
                    client_id=self.kwargs.pop("client_id"),
                )
            # default credential
            else:
                default_credential = azure.identity.DefaultAzureCredential(exclude_shared_token_cache_credential=True)

            self.kwargs["azure_ad_token_provider"] = azure.identity.get_bearer_token_provider(
                default_credential, "https://cognitiveservices.azure.com/.default"
            )

        self.api = self.prompty.model.api
        self.deployment = self.prompty.model.connection["azure_deployment"]
        self.options = self.prompty.model.options

    def _sanitize_messages(self, data: typing.Any, ignore_thread_content=False) -> list[dict[str, str]]:
        messages = data if isinstance(data, list) else [data]

        if self.prompty.template.strict:
            if not all([msg["nonce"] == self.prompty.template.nonce for msg in messages]):
                raise ValueError("Nonce mismatch in messages array (strict mode)")

        messages = []
        for msg in data:
            if msg["role"] == "thread":
                thread = self.prompty.get_input("thread")
                if thread is None:
                    raise ValueError("thread requires thread input")

                if thread.value is None:
                    thread.value = []

                if not ignore_thread_content:
                    thread.value.append({"role": "user", "content": msg["content"]})

                if isinstance(thread.value, list):
                    messages = [*messages, *thread.value]
                elif isinstance(thread.value, dict):
                    messages.append(
                        {
                            **{"role": thread.value["role"], "content": thread.value["content"]},
                            **({"name": thread.value["name"]} if "name" in thread.value else {}),
                        }
                    )
                else:
                    messages.append(thread.value)
            else:
                messages.append(
                    {
                        **{"role": msg["role"], "content": msg["content"]},
                        **({"name": msg["name"]} if "name" in msg else {}),
                    }
                )

        return messages

    def _get_ctor(self) -> AzureOpenAI:
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
            return client

    def _get_async_ctor(self) -> AsyncAzureOpenAI:
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
            return client

    def _resolve_chat_args(self, data: typing.Any, ignore_thread_content=False) -> dict:
        messages = self._sanitize_messages(data, ignore_thread_content)

        args = {
            "model": self.deployment,
            "messages": messages,
            **self.options,
        }

        if "tools" not in self.options and len(self.prompty.tools) > 0:
            # add tools to options:
            args = {**args, "tools": convert_function_tools(self.prompty.tools)}

        if len(self.prompty.outputs) > 0:
            # add outputs to options:
            args = {
                **args,
                "response_format": convert_output_props(
                    self.prompty.name.lower().replace(" ", "_"), self.prompty.outputs
                ),
            }

        return args

    def _create_chat(self, client: AzureOpenAI, data: typing.Any, ignore_thread_content=False) -> typing.Any:
        with Tracer.start("create") as trace:
            trace("type", "LLM")
            trace("description", "Azure OpenAI Client")
            trace("signature", "AzureOpenAI.chat.completions.create")
            args = self._resolve_chat_args(data, ignore_thread_content)
            trace("inputs", args)
            if "stream" in args and args["stream"]:
                response = client.chat.completions.create(**args)
            else:
                raw = client.chat.completions.with_raw_response.create(**args)

                response = ChatCompletion.model_validate_json(raw.text)

                for k, v in raw.headers.raw:
                    trace(k.decode("utf-8"), v.decode("utf-8"))

                trace("request_id", raw.request_id)
                trace("retries_taken", raw.retries_taken)
            trace("result", response)
            return response

    async def _create_chat_async(
        self, client: AsyncAzureOpenAI, data: typing.Any, ignore_thread_content=False
    ) -> typing.Any:
        with Tracer.start("create") as trace:
            trace("type", "LLM")
            trace("description", "Azure OpenAI Client")

            trace("signature", "AzureOpenAIAsync.chat.completions.create")
            args = self._resolve_chat_args(data, ignore_thread_content)
            trace("inputs", args)
            if "stream" in args and args["stream"]:
                response = await client.chat.completions.create(**args)
            else:
                raw: APIResponse = await client.chat.completions.with_raw_response.create(**args)
                if raw is not None and raw.text is not None and isinstance(raw.text, str):
                    response = ChatCompletion.model_validate_json(raw.text)

                for k, v in raw.headers.raw:
                    trace(k.decode("utf-8"), v.decode("utf-8"))

                trace("request_id", raw.request_id)
                trace("retries_taken", raw.retries_taken)
            trace("result", response)

            return response

    def _execute_agent(self, client: AzureOpenAI, data: typing.Any) -> typing.Any:
        with Tracer.start("create") as trace:
            trace("type", "LLM")
            trace("description", "Azure OpenAI Client")

            trace("signature", "AzureOpenAI.chat.agent.create")
            trace("inputs", data)

            response = self._create_chat(client, data)
            if isinstance(response, ChatCompletion):
                message = response.choices[0].message
                if message.tool_calls:
                    thread = self.prompty.get_input("thread")
                    if thread is None:
                        raise ValueError("thread requires thread input")

                    thread.value.append(
                        {
                            "role": "assistant",
                            "tool_calls": [t.model_dump() for t in message.tool_calls],
                        }
                    )

                    for tool_call in message.tool_calls:
                        tool = self.prompty.get_tool(tool_call.function.name)
                        if tool is None:
                            raise ValueError(f"Tool {tool_call.function.name} does not exist")

                        function_args = json.loads(tool_call.function.arguments)

                        if tool.value is None:
                            raise ValueError(f"Tool {tool_call.function.name} does not have a value")

                        r = tool.value(**function_args)

                        thread.value.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call.id,
                                "name": tool_call.function.name,
                                "content": r,
                            }
                        )
                else:
                    trace("result", response)
                    return response

            response = self._create_chat(client, data, True)
            trace("result", response)

            return response

    async def _execute_agent_async(self, client: AsyncAzureOpenAI, data: typing.Any) -> typing.Any:
        with Tracer.start("create") as trace:
            trace("type", "LLM")
            trace("description", "Azure OpenAI Client")
            trace("signature", "AzureOpenAI.chat.agent.create")
            args = self._resolve_chat_args(data)
            trace("inputs", args)
            response = 5
            trace("result", response)
            return response

    def _create_completion(self, client: AzureOpenAI, data: typing.Any) -> typing.Any:
        with Tracer.start("create") as trace:
            trace("type", "LLM")
            trace("description", "Azure OpenAI Client")

            trace("signature", "AzureOpenAI.completions.create")
            args = {
                "prompt": data,
                "model": self.deployment,
                **self.options,
            }
            trace("inputs", args)
            response = client.completions.create(**args)
            trace("result", response)
            return response

    async def _create_completion_async(self, client: AsyncAzureOpenAI, data: typing.Any) -> typing.Any:
        with Tracer.start("create") as trace:
            trace("type", "LLM")
            trace("description", "Azure OpenAI Client")

            trace("signature", "AzureOpenAIAsync.completions.create")
            args = {
                "prompt": data,
                "model": self.deployment,
                **self.options,
            }
            trace("inputs", args)

            response = await client.completions.create(**args)
            trace("result", response)

            return response

    def _create_embedding(self, client: AzureOpenAI, data: typing.Any) -> typing.Any:
        with Tracer.start("create") as trace:
            trace("type", "LLM")
            trace("description", "Azure OpenAI Client")

            trace("signature", "AzureOpenAI.embeddings.create")
            args = {
                "input": data if isinstance(data, list) else [data],
                "model": self.deployment,
                **self.options,
            }
            trace("inputs", args)
            response = client.embeddings.create(**args)
            trace("result", response)

            return response

    async def _create_embedding_async(self, client: AsyncAzureOpenAI, data: typing.Any) -> typing.Any:
        with Tracer.start("create") as trace:
            trace("type", "LLM")
            trace("description", "Azure OpenAI Client")

            trace("signature", "AzureOpenAIAsync.embeddings.create")
            args = {
                "input": data if isinstance(data, list) else [data],
                "model": self.deployment,
                **self.options,
            }
            trace("inputs", args)
            response = await client.embeddings.create(**args)
            trace("result", response)

            return response

    def _create_image(self, client: AzureOpenAI, data: typing.Any) -> typing.Any:
        with Tracer.start("create") as trace:
            trace("type", "LLM")
            trace("description", "Azure OpenAI Client")

            trace("signature", "AzureOpenAI.images.generate")
            args = {
                "prompt": data,
                "model": self.deployment,
                **self.options,
            }
            trace("inputs", args)
            response = client.images.generate(**args)
            trace("result", response)
            return response

    async def _create_image_async(self, client: AsyncAzureOpenAI, data: typing.Any) -> typing.Any:
        with Tracer.start("create") as trace:
            trace("type", "LLM")
            trace("description", "Azure OpenAI Client")

            trace("signature", "AzureOpenAIAsync.images.generate")
            args = {
                "prompt": data,
                "model": self.deployment,
                **self.options,
            }
            trace("inputs", args)
            response = await client.images.generate(**args)
            trace("result", response)

            return response

    def invoke(self, data: typing.Any) -> typing.Union[str, PromptyStream]:
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

        client = self._get_ctor()

        if self.api == "chat":
            response = self._create_chat(client, data)
        elif self.api == "agent":
            response = self._execute_agent(client, data)
        elif self.api == "completion":
            response = self._create_completion(client, data)
        elif self.api == "embedding":
            response = self._create_embedding(client, data)
        elif self.api == "image":
            response = self._create_image(client, data)

        # stream response
        if isinstance(response, Iterator):
            if self.api == "chat":
                # TODO: handle the case where there might be no usage in the stream
                return PromptyStream("AzureOpenAIExecutor", response)
            else:
                return PromptyStream("AzureOpenAIExecutor", response)
        else:
            return response

    async def invoke_async(self, data: str) -> typing.Union[str, AsyncPromptyStream]:
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
        client = self._get_async_ctor()

        if self.api == "chat":
            response = await self._create_chat_async(client, data)
        elif self.api == "agent":
            response = await self._execute_agent_async(client, data)
        elif self.api == "completion":
            response = await self._create_completion_async(client, data)
        elif self.api == "embedding":
            response = await self._create_embedding_async(client, data)
        elif self.api == "image":
            response = await self._create_image_async(client, data)

        # stream response
        if isinstance(response, AsyncIterator):
            if self.api == "chat":
                # TODO: handle the case where there might be no usage in the stream
                return AsyncPromptyStream("AzureOpenAIExecutorAsync", response)
            else:
                return AsyncPromptyStream("AzureOpenAIExecutorAsync", response)
        else:
            return response
