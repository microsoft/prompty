from pathlib import Path

import pytest

import prompty
from prompty.azure import AzureOpenAIProcessor
from prompty.invoker import InvokerFactory
from tests.fake_azure_executor import FakeAzureExecutor


@pytest.fixture(scope="module", autouse=True)
def fake_azure_executor():
    InvokerFactory.add_executor("azure", FakeAzureExecutor)
    InvokerFactory.add_executor("azure_openai", FakeAzureExecutor)
    InvokerFactory.add_processor("azure", AzureOpenAIProcessor)
    InvokerFactory.add_processor("azure_openai", AzureOpenAIProcessor)


BASE_PATH = str(Path(__file__).absolute().parent.as_posix())


@pytest.mark.parametrize(
    "prompt",
    [
        "prompts/basic.prompty",
        "prompts/basic_mustache.prompty",
        "prompts/context.prompty",
        "prompts/groundedness.prompty",
    ],
)
def test_renderer_invoker(prompt: str):
    p = prompty.load(prompt)
    result = InvokerFactory.run("renderer", p, p.get_sample())
    print(result)


@pytest.mark.parametrize(
    "markdown",
    [
        "1contoso.md",
        "2contoso.md",
        "3contoso.md",
        "4contoso.md",
        "contoso_multi.md",
        "basic.prompty.md",
        "context.prompty.md",
        "groundedness.prompty.md",
    ],
)
def test_parser_invoker(markdown: str):
    with open(f"{BASE_PATH}/generated/{markdown}", encoding="utf-8") as f:
        content = f.read()
    prompt = prompty.load("prompts/basic.prompty")
    result = InvokerFactory.run_parser(prompt, content)
    print(result)


@pytest.mark.parametrize(
    "prompt",
    [
        "prompts/basic.prompty",
        "prompts/context.prompty",
        "prompts/groundedness.prompty",
    ],
)
def test_executor_invoker(prompt: str):
    p = prompty.load(prompt)

    result = InvokerFactory.run_renderer(p, p.get_sample())
    result = InvokerFactory.run_parser(p, result)
    result = InvokerFactory.run_executor(p, result)
    print(result)


@pytest.mark.parametrize(
    "prompt",
    [
        "prompts/basic.prompty",
        "prompts/context.prompty",
        "prompts/groundedness.prompty",
    ],
)
def test_processor_invoker(prompt: str):
    p = prompty.load(prompt)
    result = InvokerFactory.run_renderer(p, p.get_sample())
    result = InvokerFactory.run_parser(p, result)
    result = InvokerFactory.run_executor(p, result)
    result = InvokerFactory.run_processor(p, result)
    print(result)
