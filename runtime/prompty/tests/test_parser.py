import re
from prompty.core import Prompty
from prompty.parsers import PromptyChatParser

roles = ["assistant", "function", "system", "user"]
def test_regex():
    content = 'system[key="value 1", other=3, pre = 0.2, post=false, great=True]:\nYou are an AI assistant\n who helps people find information.\nAs the assistant, you answer questions briefly, succinctly.\n\nuser:\nWhat is the meaning of life?'
    parser = PromptyChatParser(Prompty())
    messages = parser.invoke(content)
    assert len(messages) == 2
    