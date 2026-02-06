import json
import re

import aiofiles
import yaml

_yaml_regex = re.compile(
    r"^\s*" + r"(?:---|\+\+\+)" + r"(.*?)" + r"(?:---|\+\+\+)" + r"\s*(.+)$",
    re.S | re.M,
)


def load_text(file_path, encoding="utf-8"):
    with open(file_path, encoding=encoding) as file:
        return file.read()


async def load_text_async(file_path, encoding="utf-8"):
    async with aiofiles.open(file_path, encoding=encoding) as f:
        content = await f.read()
        return content


def load_json(file_path, encoding="utf-8"):
    return json.loads(load_text(file_path, encoding=encoding))


async def load_json_async(file_path, encoding="utf-8"):
    # async file open
    content = await load_text_async(file_path, encoding=encoding)
    return json.loads(content)


def load_prompty(file_path, encoding="utf-8"):
    contents = load_text(file_path, encoding=encoding)
    return parse(contents)


async def load_prompty_async(file_path, encoding="utf-8"):
    contents = await load_text_async(file_path, encoding=encoding)
    return parse(contents)


def parse(contents):
    global _yaml_regex

    isMarkdown = re.match(r"^\s*(?:---)", contents) is not None

    if isMarkdown:
        result = _yaml_regex.search(contents)
        if result:
            fmatter = result.group(1)
            body = result.group(2)
            # instructions is in the body
            content = yaml.load(fmatter, Loader=yaml.FullLoader)
            if content is None:
                content = {}
            content["instructions"] = body
            return content
        else:
            raise ValueError("Invalid Markdown format: Missing or malformed frontmatter.")
    else:
        content = yaml.load(contents, Loader=yaml.FullLoader)
        return content
