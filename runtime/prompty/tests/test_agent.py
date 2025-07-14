import json
from pathlib import Path
from unittest.mock import patch

import pytest
from dotenv import load_dotenv
from openai.types.chat.chat_completion import ChatCompletion

import prompty
from prompty.azure import AzureOpenAIProcessor
from prompty.invoker import InvokerFactory
from prompty.serverless import ServerlessProcessor
from prompty.tracer import PromptyTracer, Tracer, console_tracer, trace
from tests.fake_serverless_executor import FakeServerlessExecutor

load_dotenv()

BASE_PATH = Path(__file__).parent


def load_chat_completion(file_path: str) -> ChatCompletion:
    with open(BASE_PATH / file_path, encoding="utf-8") as f:
        return ChatCompletion.model_validate(json.load(f))


@trace
def get_current_weather(city: str, unit: str = "Celsius"):
    return f"The weather in {city} is 32 {unit}"


@trace
async def get_current_weather_async(city: str, unit: str = "Celsius"):
    return f"The weather in {city} is 32 {unit}"


@pytest.fixture(scope="module", autouse=True)
def fake_azure_executor():
    InvokerFactory.add_processor("azure", AzureOpenAIProcessor)
    InvokerFactory.add_processor("azure_openai", AzureOpenAIProcessor)
    InvokerFactory.add_executor("serverless", FakeServerlessExecutor)
    InvokerFactory.add_processor("serverless", ServerlessProcessor)

    Tracer.add("console", console_tracer)
    json_tracer = PromptyTracer()
    Tracer.add("PromptyTracer", json_tracer.tracer)


@trace
@pytest.mark.parametrize(
    "prompt",
    [
        "agent/simple_agent.prompty",
    ],
)
def test_execute_agent(prompt: str):
    p = prompty.load(prompt)
    # set the tool function
    p.set_tool_value("get_current_weather", get_current_weather)
    with patch("prompty.azure.AzureOpenAIExecutor._execute_chat_completion") as mock_create_chat:
        first = load_chat_completion(f"{prompt}.1.execution.json")
        second = load_chat_completion(f"{prompt}.2.execution.json")
        mock_create_chat.side_effect = [first, second]
        result = prompty.execute(p, inputs={"question": "What was the weather like in Tokyo?"}, merge_sample=True)
    return result


@trace
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "prompt",
    [
        "agent/simple_agent.prompty",
    ],
)
async def test_execute_agent_async(prompt: str):
    p = prompty.load(prompt)
    # set the tool function
    p.set_tool_value("get_current_weather", get_current_weather_async)
    with patch("prompty.azure.AzureOpenAIExecutor._execute_chat_completion_async") as mock_create_chat:
        first = load_chat_completion(f"{prompt}.1.execution.json")
        second = load_chat_completion(f"{prompt}.2.execution.json")
        mock_create_chat.side_effect = [first, second]
        result = await prompty.execute_async(
            p, inputs={"question": "What was the weather like in Tokyo?"}, merge_sample=True
        )
    return result
