"""Frontmatter parsing, file I/O helpers."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import aiofiles
import yaml

_yaml_regex = re.compile(
    r"^\s*" + r"(?:---|\+\+\+)" + r"(.*?)" + r"(?:---|\+\+\+)" + r"\s*(.+)$",
    re.S | re.M,
)


def load_text(file_path: str | Path, encoding: str = "utf-8") -> str:
    with open(file_path, encoding=encoding) as file:
        return file.read()


async def load_text_async(file_path: str | Path, encoding: str = "utf-8") -> str:
    async with aiofiles.open(file_path, encoding=encoding) as f:
        content = await f.read()
        return content


def load_json(file_path: str | Path, encoding: str = "utf-8") -> Any:
    return json.loads(load_text(file_path, encoding=encoding))


async def load_json_async(file_path: str | Path, encoding: str = "utf-8") -> Any:
    content = await load_text_async(file_path, encoding=encoding)
    return json.loads(content)


def load_prompty(file_path: str | Path, encoding: str = "utf-8") -> dict[str, Any] | str:
    contents = load_text(file_path, encoding=encoding)
    return parse(contents)


async def load_prompty_async(file_path: str | Path, encoding: str = "utf-8") -> dict[str, Any] | str:
    contents = await load_text_async(file_path, encoding=encoding)
    return parse(contents)


def parse(contents: str) -> dict[str, Any] | str:
    is_markdown = re.match(r"^\s*(?:---)", contents) is not None

    if is_markdown:
        result = _yaml_regex.search(contents)
        if result:
            fmatter = result.group(1)
            body = result.group(2)
            content = yaml.safe_load(fmatter)
            if content is None:
                content = {}
            content["instructions"] = body
            return content
        else:
            raise ValueError("Invalid Markdown format: Missing or malformed frontmatter.")
    else:
        content = yaml.safe_load(contents)
        return content
