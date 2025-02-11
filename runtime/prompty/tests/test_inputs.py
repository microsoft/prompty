import pytest
import prompty

@pytest.mark.parametrize(
    "prompt",
    [
        "typed-prompts/basic.prompty",
        "prompts/chat.prompty",
        "prompts/context.prompty"
    ],
)
def test_load(prompt: str):
    p = prompty.load(prompt)
    print(p)