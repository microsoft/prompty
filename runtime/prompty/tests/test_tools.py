import pytest

import prompty
from prompty.azure.processor import AzureOpenAIProcessor
from prompty.invoker import InvokerFactory
from prompty.serverless.processor import ServerlessProcessor
from tests.fake_azure_executor import FakeAzureExecutor
from tests.fake_serverless_executor import FakeServerlessExecutor


@pytest.fixture(scope="module", autouse=True)
def fake_azure_executor():
    InvokerFactory.add_executor("azure", FakeAzureExecutor)
    InvokerFactory.add_executor("azure_openai", FakeAzureExecutor)
    InvokerFactory.add_executor("azure_beta", FakeAzureExecutor)
    InvokerFactory.add_executor("azure_openai_beta", FakeAzureExecutor)
    InvokerFactory.add_processor("azure", AzureOpenAIProcessor)
    InvokerFactory.add_processor("azure_openai", AzureOpenAIProcessor)
    InvokerFactory.add_executor("azure_beta", AzureOpenAIProcessor)
    InvokerFactory.add_executor("azure_openai_beta", AzureOpenAIProcessor)
    InvokerFactory.add_executor("serverless", FakeServerlessExecutor)
    InvokerFactory.add_processor("serverless", ServerlessProcessor)


def test_basic_load():
    prompt = "tools/basic.prompty"
    p = prompty.load(prompt)
    assert len(p.tools) == 1
    assert p.tools[0].id == "bing"
    assert p.tools[0].type == "web_search"
    assert p.tools[0].description == "A tool that can search the web for information."
    assert "url" in p.tools[0].options and p.tools[0].options["url"] == "${env:BING_URL}"
    assert len(p.tools[0].parameters) == 2
    print(p)


@pytest.mark.asyncio
async def test_basic_async_load():
    prompt = "tools/basic.prompty"
    p = await prompty.load_async(prompt)
    assert len(p.tools) == 1
    assert p.tools[0].id == "bing"
    assert p.tools[0].type == "web_search"
    assert p.tools[0].description == "A tool that can search the web for information."
    assert "url" in p.tools[0].options and p.tools[0].options["url"] == "${env:BING_URL}"
    assert len(p.tools[0].parameters) == 2
    print(p)


def test_dynamic_load():
    prompt = "tools/dynamic.prompty"
    p = prompty.load(prompt)
    prompty.prepare(p, merge_sample=True)
    assert len(p.tools) == 2
    assert p.tools[0].id == "bing"
    assert p.tools[0].type == "web_search"
    assert p.tools[0].description == "A tool that can search the web for information."
    assert "url" in p.tools[0].options and p.tools[0].options["url"] == "https://api.bing.microsoft.com/v7.0/search"
    assert len(p.tools[0].parameters) == 2

    assert p.tools[1].id == "callable"
    assert p.tools[1].type == "function"
    print(p)


@pytest.mark.asyncio
async def test_dynamic_async_load():
    prompt = "tools/dynamic.prompty"
    p = await prompty.load_async(prompt)
    await prompty.prepare_async(p, merge_sample=True)
    assert len(p.tools) == 2
    assert p.tools[0].id == "bing"
    assert p.tools[0].type == "web_search"
    assert p.tools[0].description == "A tool that can search the web for information."
    assert "url" in p.tools[0].options and p.tools[0].options["url"] == "https://api.bing.microsoft.com/v7.0/search"
    assert len(p.tools[0].parameters) == 2

    assert p.tools[1].id == "callable"
    assert p.tools[1].type == "function"
    print(p)
