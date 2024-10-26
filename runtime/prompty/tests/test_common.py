import asyncio
import pytest
import prompty


@pytest.mark.parametrize(
    "prompt",
    [
        "prompts/basic.prompty",
        "prompts/basic_json_output.prompty",
        "prompts/chat.prompty",
        "prompts/context.prompty",
        "prompts/embedding.prompty",
        "prompts/evaluation.prompty",
        "prompts/faithfulness.prompty",
        "prompts/funcfile.prompty",
        "prompts/functions.prompty",
        "prompts/groundedness.prompty",
        "prompts/sub/basic.prompty",
        "prompts/sub/sub/basic.prompty",
    ],
)
def test_load(prompt: str):
    p = prompty.load(prompt)
    print(p)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "prompt",
    [
        "prompts/basic.prompty",
        "prompts/basic_json_output.prompty",
        "prompts/chat.prompty",
        "prompts/context.prompty",
        "prompts/embedding.prompty",
        "prompts/evaluation.prompty",
        "prompts/faithfulness.prompty",
        "prompts/funcfile.prompty",
        "prompts/functions.prompty",
        "prompts/groundedness.prompty",
        "prompts/sub/basic.prompty",
        "prompts/sub/sub/basic.prompty",
    ],
)
async def test_load_async(prompt: str):
    p = await prompty.load_async(prompt)
    print(p)
