import pytest
import prompty
from pathlib import Path

BASE_PATH = str(Path(__file__).absolute().parent.as_posix())


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
