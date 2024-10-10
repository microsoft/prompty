import pytest
import prompty
from pathlib import Path
from prompty.core import InvokerFactory

from tests.fake_azure_executor import FakeAzureExecutor
from prompty.azure import AzureOpenAIProcessor


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
        "prompts/context.prompty",
        "prompts/groundedness.prompty",
        "prompts/faithfulness.prompty",
    ],
)
def test_renderer_invoker(prompt: str):
    p = prompty.load(prompt)
    renderer = InvokerFactory.create_renderer("jinja2", p)
    result = renderer(p.sample)
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
    with open(f"{BASE_PATH}/generated/{markdown}", "r", encoding="utf-8") as f:
        content = f.read()
    prompt = prompty.load("prompts/basic.prompty")
    parser = InvokerFactory.create_parser("prompty.chat", prompt)
    result = parser(content)
    print(result)


@pytest.mark.parametrize(
    "prompt",
    [
        "prompts/basic.prompty",
        "prompts/context.prompty",
        "prompts/groundedness.prompty",
        "prompts/faithfulness.prompty",
    ],
)
def test_executor_invoker(prompt: str):
    p = prompty.load(prompt)
    renderer = InvokerFactory.create_renderer("jinja2", p)
    result = renderer(p.sample)

    parser = InvokerFactory.create_parser("prompty.chat", p)
    result = parser(result)

    executor = InvokerFactory.create_executor("azure", p)
    result = executor(result)
    print(result)


@pytest.mark.parametrize(
    "prompt",
    [
        "prompts/basic.prompty",
        "prompts/context.prompty",
        "prompts/groundedness.prompty",
        "prompts/faithfulness.prompty",
    ],
)
def test_processor_invoker(prompt: str):
    p = prompty.load(prompt)
    renderer = InvokerFactory.create_renderer("jinja2", p)
    result = renderer(p.sample)

    parser = InvokerFactory.create_parser("prompty.chat", p)
    result = parser(result)

    executor = InvokerFactory.create_executor("azure", p)
    result = executor(result)

    processor = InvokerFactory.create_processor("azure", p)
    result = processor(result)
    print(result)
