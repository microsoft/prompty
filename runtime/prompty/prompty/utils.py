import json
import re
import typing
from pathlib import Path

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


def _walk_up_path(path: Path) -> typing.Union[Path, None]:
    """Walk up the path to find a prompty.json file.

    Args:
        path (Path): The path to start searching from.
    """
    while path != path.parent:
        # Check if the prompty.json file exists in the current directory
        prompty_config = path / "prompty.json"
        if prompty_config.exists():
            return prompty_config
        # Move up to the parent directory
        path = path.parent
    return None


def _find_global_config(prompty_path: Path = Path.cwd()) -> typing.Union[Path, None]:
    """Find the prompty.json file in the current directory or any parent directory.
    Args:
        prompty_path (Path): The path to start searching from.
    """
    if Path(prompty_path / "prompty.json").exists():
        return Path(prompty_path / "prompty.json")
    else:
        return _walk_up_path(prompty_path)


def load_global_config(prompty_path: Path = Path.cwd(), configuration: str = "default") -> dict[str, typing.Any]:
    # prompty.config laying around?
    config = _find_global_config(prompty_path)

    # if there is one load it
    if config is not None:
        c = load_json(config)
        if configuration in c:
            return c[configuration]
        else:
            raise ValueError(f'Item "{configuration}" not found in "{config}"')

    return {}


async def load_global_config_async(
    prompty_path: Path = Path.cwd(), configuration: str = "default"
) -> dict[str, typing.Any]:
    # prompty.config laying around?
    config = _find_global_config(prompty_path)

    # if there is one load it
    if config is not None:
        c = await load_json_async(config)
        if configuration in c:
            return c[configuration]
        else:
            raise ValueError(f'Item "{configuration}" not found in "{config}"')

    return {}


def get_json_type(t: type) -> typing.Literal["string", "number", "array", "object", "boolean"]:
    if t is str:
        return "string"
    elif t is int:
        return "number"
    elif t is float:
        return "number"
    elif t is list:
        return "array"
    elif t is dict:
        return "object"
    elif t is bool:
        return "boolean"
    else:
        raise ValueError(f"Unsupported type: {t}")


def load_prompty(file_path, encoding="utf-8"):
    contents = load_text(file_path, encoding=encoding)
    return parse(contents)


async def load_prompty_async(file_path, encoding="utf-8"):
    contents = await load_text_async(file_path, encoding=encoding)
    return parse(contents)


def parse(contents):
    global _yaml_regex

    fmatter = ""
    body = ""
    result = _yaml_regex.search(contents)

    if result:
        fmatter = result.group(1)
        body = result.group(2)
    return {
        "attributes": yaml.load(fmatter, Loader=yaml.FullLoader),
        "body": body,
        "frontmatter": fmatter,
    }
