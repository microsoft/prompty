import pytest

import prompty


@pytest.mark.parametrize(
    "prompt",
    [
        "mustache/basic.prompty",
    ],
)
def test_load(prompt: str):
    p = prompty.load(prompt)
    o = prompty.prepare(
        p,
        inputs={
            "firstName": "John",
            "lastName": "Doe",
            "question": "What is your name?",
        },
    )
    print(o)
