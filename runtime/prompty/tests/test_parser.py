import prompty
from pathlib import Path
from prompty.core import Prompty, TemplateProperty
from prompty.parsers import PromptyChatParser

roles = ["assistant", "function", "system", "user"]


def test_parse_with_args():
    content = 'system[key="value 1", post=false, great=True, other=3.2, pre = 2]:\nYou are an AI assistant\n who helps people find information.\nAs the assistant, you answer questions briefly, succinctly.\n\nuser:\nWhat is the meaning of life?'
    parser = PromptyChatParser(Prompty())
    messages = parser.invoke(content)
    assert len(messages) == 2
    assert messages[0]["role"] == "system"
    assert messages[0]["key"] == "value 1"
    assert messages[0]["post"] is False
    assert messages[0]["great"] is True
    assert messages[0]["other"] == 3.2
    assert messages[0]["pre"] == 2
    assert messages[1]["role"] == "user"


def test_parse_invalid_args():
    content = 'system[role="value 1", content="overwrite content",post=false, great=True, other=3.2, pre = 2]:\nYou are an AI assistant\n who helps people find information.\nAs the assistant, you answer questions briefly, succinctly.\n\nuser:\nWhat is the meaning of life?'
    parser = PromptyChatParser(Prompty())
    messages = parser.invoke(content)
    assert len(messages) == 2
    assert messages[0]["role"] == "system"
    assert (
        messages[0]["content"]
        == "You are an AI assistant\n who helps people find information.\nAs the assistant, you answer questions briefly, succinctly.\n"
    )
    assert messages[1]["role"] == "user"


def test_thread_parse():
    p = prompty.load("tools/basic.prompty")
    content = prompty.prepare(p, merge_sample=True)
    assert len(content) == 3
    assert content[0]["role"] == "system"
    assert content[1]["role"] == "thread"
    assert content[2]["role"] == "system"


def test_disable_image_parsing():
    """Test that image parsing can be disabled via template options"""

    # Create a prompty with image parsing disabled
    template = TemplateProperty(format="jinja2", parser="prompty", options={"disable_image_parsing": True})

    prompty_obj = Prompty(template=template, file=Path("/tmp/test.prompty"))
    parser = PromptyChatParser(prompty_obj)

    # Test content with markdown images
    content_with_images = """Here's some text with an image:
![Test Image](test_image.png)
And some more text."""

    # Parse the content - should return as-is without image processing
    result = parser.parse_content(content_with_images)

    # Verify that the content is returned unchanged (no image processing)
    assert result == content_with_images


def test_normal_image_parsing():
    """Test that image parsing works normally when not disabled"""

    # Create a prompty with default settings (image parsing enabled)
    template = TemplateProperty(
        format="jinja2",
        parser="prompty",
        options={},  # No disable_image_parsing option
    )

    prompty_obj = Prompty(template=template, file=Path("/tmp/test.prompty"))
    parser = PromptyChatParser(prompty_obj)

    # Test content with markdown images (using URL to avoid file access issues)
    content_with_images = """Here's some text with an image:
![Test Image](http://example.com/test.png)
And some more text."""

    # Parse the content - should process images normally
    result = parser.parse_content(content_with_images)

    # Verify that image processing was attempted (result should be structured)
    assert isinstance(result, list)
    assert len(result) == 3  # text, image, text
    assert result[0]["type"] == "text"
    assert result[0]["text"] == "Here's some text with an image:"
    assert result[1]["type"] == "image_url"
    assert result[1]["image_url"]["url"] == "http://example.com/test.png"
    assert result[2]["type"] == "text"
    assert result[2]["text"] == "And some more text."


def test_image_parsing_with_only_text():
    """Test that content without images is handled correctly regardless of the setting"""

    # Test with image parsing disabled
    template_disabled = TemplateProperty(format="jinja2", parser="prompty", options={"disable_image_parsing": True})

    prompty_disabled = Prompty(template=template_disabled, file=Path("/tmp/test.prompty"))
    parser_disabled = PromptyChatParser(prompty_disabled)

    # Test with image parsing enabled
    template_enabled = TemplateProperty(format="jinja2", parser="prompty", options={})

    prompty_enabled = Prompty(template=template_enabled, file=Path("/tmp/test.prompty"))
    parser_enabled = PromptyChatParser(prompty_enabled)

    # Content without any images
    text_only_content = "This is just plain text without any images."

    # Both should return the same result (plain text)
    result_disabled = parser_disabled.parse_content(text_only_content)
    result_enabled = parser_enabled.parse_content(text_only_content)

    assert result_disabled == text_only_content
    assert result_enabled == text_only_content
    assert result_disabled == result_enabled
