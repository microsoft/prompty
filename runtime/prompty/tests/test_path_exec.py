import prompty
import pytest
from pathlib import Path

BASE_PATH = str(Path(__file__).absolute().parent.as_posix())


def test_prompty_config_local():
    p = prompty.load(f"{BASE_PATH}/prompts/sub/sub/basic.prompty")
    assert p.model.configuration["type"] == "TEST_LOCAL"


@pytest.mark.asyncio
async def test_prompty_config_local_async():
    p = await prompty.load_async(f"{BASE_PATH}/prompts/sub/sub/basic.prompty")
    assert p.model.configuration["type"] == "TEST_LOCAL"


def test_prompty_config_global():
    p = prompty.load(f"{BASE_PATH}/prompts/sub/basic.prompty")
    assert p.model.configuration["type"] == "azure"


@pytest.mark.asyncio
async def test_prompty_config_global_async():
    p = await prompty.load_async(f"{BASE_PATH}/prompts/sub/basic.prompty")
    assert p.model.configuration["type"] == "azure"


def test_prompty_config_headless():
    p = prompty.headless(
        "embedding", ["this is the first line", "this is the second line"]
    )
    assert p.model.configuration["type"] == "FROM_CONTENT"


@pytest.mark.asyncio
async def test_prompty_config_headless_async():
    p = await prompty.headless_async(
        "embedding", ["this is the first line", "this is the second line"]
    )
    assert p.model.configuration["type"] == "FROM_CONTENT"


# make sure the prompty path is
# relative to the current executing file
def test_prompty_relative_local():
    from tests.prompts.test import run

    p = run()
    assert p.name == "Basic Prompt"


@pytest.mark.asyncio
async def test_prompty_relative_local_async():
    from tests.prompts.test import run_async

    p = await run_async()
    assert p.name == "Basic Prompt"


def test_prompty_relative():
    from tests.prompts.sub.sub.test import run

    p = run()
    assert p.name == "Prompt with complex context"


@pytest.mark.asyncio
async def test_prompty_relative_async():
    from tests.prompts.sub.sub.test import run_async

    p = await run_async()
    assert p.name == "Prompt with complex context"
