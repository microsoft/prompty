from __future__ import annotations

import os
import re
import yaml
import json
import abc
from pathlib import Path
from pydantic import BaseModel, Field, FilePath
from typing import List, Literal, Dict, Callable, TypeVar


T = TypeVar("T")


class PropertySettings(BaseModel):
    type: Literal["string", "number", "array", "object", "boolean"]
    default: str | int | float | List | dict | bool = Field(default=None)
    description: str = Field(default="")


class ModelSettings(BaseModel):
    api: str = Field(default="")
    configuration: dict = Field(default={})
    parameters: dict = Field(default={})
    response: dict = Field(default={})

    def model_dump_safe(self) -> dict:
        d = self.model_dump()
        d["configuration"] = {
            k: "*" * len(v) if "key" in k.lower() or "secret" in k.lower() else v
            for k, v in d["configuration"].items()
        }
        return d


class TemplateSettings(BaseModel):
    type: str = Field(default="jinja2")
    parser: str = Field(default="")


class Prompty(BaseModel):
    # metadata
    name: str = Field(default="")
    description: str = Field(default="")
    authors: List[str] = Field(default=[])
    tags: List[str] = Field(default=[])
    version: str = Field(default="")
    base: str = Field(default="")
    basePrompty: Prompty | None = Field(default=None)
    # model
    model: ModelSettings = Field(default_factory=ModelSettings)

    # sample
    sample: dict = Field(default={})

    # input / output
    inputs: Dict[str, PropertySettings] = Field(default={})
    outputs: Dict[str, PropertySettings] = Field(default={})

    # template
    template: TemplateSettings

    file: FilePath = Field(default="")
    content: str | List[str] | dict = Field(default="")

    def to_safe_dict(self) -> Dict[str, any]:
        d = {}
        for k, v in self:
            if v != "" and v != {} and v != [] and v != None:
                if k == "model":
                    d[k] = v.model_dump_safe()
                elif k == "template":
                    d[k] = v.model_dump()
                elif k == "inputs" or k == "outputs":
                    d[k] = {k: v.model_dump() for k, v in v.items()}
                elif k == "file":
                    d[k] = (
                        str(self.file.as_posix())
                        if isinstance(self.file, Path)
                        else self.file
                    )
                elif k == "basePrompty":
                    # no need to serialize basePrompty
                    continue

                else:
                    d[k] = v
        return d

    # generate json representation of the prompty
    def to_safe_json(self) -> str:
        d = self.to_safe_dict()
        return json.dumps(d)

    @staticmethod
    def _process_file(file: str, parent: Path) -> any:
        file = Path(parent / Path(file)).resolve().absolute()
        if file.exists():
            with open(str(file), "r") as f:
                items = json.load(f)
                if isinstance(items, list):
                    return [Prompty.normalize(value, parent) for value in items]
                elif isinstance(items, dict):
                    return {
                        key: Prompty.normalize(value, parent)
                        for key, value in items.items()
                    }
                else:
                    return items
        else:
            raise FileNotFoundError(f"File {file} not found")

    @staticmethod
    def _process_env(variable: str, env_error=True) -> any:
        if variable in os.environ.keys():
            return os.environ[variable]
        else:
            if env_error:
                raise ValueError(f"Variable {variable} not found in environment")
            else:
                return ""

    @staticmethod
    def normalize(attribute: any, parent: Path, env_error=True) -> any:
        if isinstance(attribute, str):
            attribute = attribute.strip()
            if attribute.startswith("${") and attribute.endswith("}"):
                # check if env or file
                variable = attribute[2:-1].split(":")
                if variable[0] == "env" and len(variable) > 1:
                    return Prompty._process_env(variable[1], env_error)
                elif variable[0] == "file" and len(variable) > 1:
                    return Prompty._process_file(variable[1], parent)
                else:
                    # old way of doing things for back compatibility
                    v = Prompty._process_env(variable[0], False)
                    if len(v) == 0:
                        if len(variable) > 1:
                            return variable[1]
                        else:
                            if env_error:
                                raise ValueError(
                                    f"Variable {variable[0]} not found in environment"
                                )
                            else:
                                return v
                    else:
                        return v
            elif (
                attribute.startswith("file:")
                and Path(parent / attribute.split(":")[1]).exists()
            ):
                # old way of doing things for back compatibility
                return Prompty._process_file(attribute.split(":")[1], parent)
            else:
                return attribute
        elif isinstance(attribute, list):
            return [Prompty.normalize(value, parent) for value in attribute]
        elif isinstance(attribute, dict):
            return {
                key: Prompty.normalize(value, parent)
                for key, value in attribute.items()
            }
        else:
            return attribute


def param_hoisting(
    top: Dict[str, any], bottom: Dict[str, any], top_key: str = None
) -> Dict[str, any]:
    if top_key:
        new_dict = {**top[top_key]} if top_key in top else {}
    else:
        new_dict = {**top}
    for key, value in bottom.items():
        if not key in new_dict:
            new_dict[key] = value
    return new_dict


class Invoker(abc.ABC):
    def __init__(self, prompty: Prompty) -> None:
        self.prompty = prompty

    @abc.abstractmethod
    def invoke(self, data: any) -> any:
        pass

    def __call__(self, data: any) -> any:
        return self.invoke(data)


class InvokerFactory:
    _renderers: Dict[str, Invoker] = {}
    _parsers: Dict[str, Invoker] = {}
    _executors: Dict[str, Invoker] = {}
    _processors: Dict[str, Invoker] = {}

    @classmethod
    def register_renderer(cls, name: str) -> Callable:
        def inner_wrapper(wrapped_class: Invoker) -> Callable:
            cls._renderers[name] = wrapped_class
            return wrapped_class

        return inner_wrapper

    @classmethod
    def register_parser(cls, name: str) -> Callable:
        def inner_wrapper(wrapped_class: Invoker) -> Callable:
            cls._parsers[name] = wrapped_class
            return wrapped_class

        return inner_wrapper

    @classmethod
    def register_executor(cls, name: str) -> Callable:
        def inner_wrapper(wrapped_class: Invoker) -> Callable:
            cls._executors[name] = wrapped_class
            return wrapped_class

        return inner_wrapper

    @classmethod
    def register_processor(cls, name: str) -> Callable:
        def inner_wrapper(wrapped_class: Invoker) -> Callable:
            cls._processors[name] = wrapped_class
            return wrapped_class

        return inner_wrapper

    @classmethod
    def create_renderer(cls, name: str, prompty: Prompty) -> Invoker:
        if name not in cls._renderers:
            raise ValueError(f"Renderer {name} not found")
        return cls._renderers[name](prompty)

    @classmethod
    def create_parser(cls, name: str, prompty: Prompty) -> Invoker:
        if name not in cls._parsers:
            raise ValueError(f"Parser {name} not found")
        return cls._parsers[name](prompty)

    @classmethod
    def create_executor(cls, name: str, prompty: Prompty) -> Invoker:
        if name not in cls._executors:
            raise ValueError(f"Executor {name} not found")
        return cls._executors[name](prompty)

    @classmethod
    def create_processor(cls, name: str, prompty: Prompty) -> Invoker:
        if name not in cls._processors:
            raise ValueError(f"Processor {name} not found")
        return cls._processors[name](prompty)


@InvokerFactory.register_renderer("NOOP")
@InvokerFactory.register_parser("NOOP")
@InvokerFactory.register_executor("NOOP")
@InvokerFactory.register_processor("NOOP")
@InvokerFactory.register_parser("prompty.embedding")
@InvokerFactory.register_parser("prompty.image")
@InvokerFactory.register_parser("prompty.completion")
class NoOp(Invoker):
    def invoke(self, data: any) -> any:
        return data


class Frontmatter:
    _yaml_delim = r"(?:---|\+\+\+)"
    _yaml = r"(.*?)"
    _content = r"\s*(.+)$"
    _re_pattern = r"^\s*" + _yaml_delim + _yaml + _yaml_delim + _content
    _regex = re.compile(_re_pattern, re.S | re.M)

    @classmethod
    def read_file(cls, path):
        """Reads file at path and returns dict with separated frontmatter.
        See read() for more info on dict return value.
        """
        with open(path, encoding="utf-8") as file:
            file_contents = file.read()
            return cls.read(file_contents)

    @classmethod
    def read(cls, string):
        """Returns dict with separated frontmatter from string.

        Returned dict keys:
        attributes -- extracted YAML attributes in dict form.
        body -- string contents below the YAML separators
        frontmatter -- string representation of YAML
        """
        fmatter = ""
        body = ""
        result = cls._regex.search(string)

        if result:
            fmatter = result.group(1)
            body = result.group(2)
        return {
            "attributes": yaml.load(fmatter, Loader=yaml.FullLoader),
            "body": body,
            "frontmatter": fmatter,
        }
