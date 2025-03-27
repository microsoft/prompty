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
        "prompts/funcfile.prompty",
        "prompts/functions.prompty",
        "prompts/structured_output.prompty",
        "prompts/groundedness.prompty",
        "prompts/sub/basic.prompty",
        "prompts/sub/sub/basic.prompty",
    ],
)
def test_load(prompt: str):
    p = prompty.load(prompt)
    print(p)


@pytest.mark.parametrize(
    "prompt",
    [
        "properties/basic_array.prompty",
        "properties/basic_dictionary.prompty",
        "properties/basic_mixed.prompty",
    ],
)
def test_complex_properties(prompt: str):
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


def test_thread_split():
    p = prompty.load("properties/thread_split.prompty")
    assert p.instructions.strip() == "before"
    assert p.additional_instructions.strip() == "after"
