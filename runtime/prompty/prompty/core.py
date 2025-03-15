import copy
import os
import typing
import uuid
import warnings
from collections.abc import AsyncIterator, Iterator
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Literal, Optional, Union

from .tracer import Tracer, to_dict
from .utils import get_json_type, load_json, load_json_async


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: str


@dataclass
class InputProperty:
    """InputProperty class to define the input properties of the model

    Attributes
    ----------
    type : str
        The type of the property
    description : str
        The description of the property
    required : bool
        Whether the property is required or not
    default : any
        The default value of the property
    sample : any
        The sample value of the property
    strict : bool
        Whether the property is strict or not
    json_schema : dict
        The json schema of the property (optional)
    """

    type: Literal["string", "number", "array", "object", "boolean"]
    name: str = field(default="")
    description: str = field(default="")
    required: bool = field(default=False)
    default: typing.Any = field(default=None)
    sample: typing.Any = field(default=None)
    strict: bool = field(default=True)
    json_schema: Optional[dict] = field(default_factory=dict)

@dataclass
class OutputProperty:
    """OutputProperty class to define the output properties of the model

    Attributes
    ----------
    type : str
        The type of the property
    description : str
        The description of the property
    default : any
        The default value of the property
    json_schema : dict
        The json schema of the property (optional)
    """

    type: Literal["string", "number", "array", "object", "boolean"]
    name: str = field(default="")
    description: str = field(default="")
    default: typing.Any = field(default=None)
    json_schema: Optional[dict] = field(default_factory=dict)


@dataclass
class ModelProperty:
    """ModelSettings class to define the model of the prompty

    Attributes
    ----------
    api : str
        The api of the model
    connection : dict
        The connection of the model
    parameters : dict
        The parameters of the model
    response : dict
        The response of the model
    """

    id: str = field(default="")
    api: str = field(default="")
    connection: dict = field(default_factory=dict)
    options: dict = field(default_factory=dict)


@dataclass
class TemplateProperty:
    """TemplateSettings class to define the template of the prompty

    Attributes
    ----------
    type : str
        The type of the template
    parser : str
        The parser of the template
    nonce : str
        Nonce is automatically genereted for each run
    content : str
        Template content used for rendering
    """

    format: str = field(default="mustache")
    parser: str = field(default="")
    nonce: str = field(default="")
    content: Union[str, list[str], dict] = field(default="")
    strict: bool = field(default=False)
    configuration: dict = field(default_factory=dict)


@dataclass
class ToolParameter:
    name: str
    type: Literal["string", "number", "array", "object", "boolean"]
    description: str = field(default="")
    required: bool = field(default=False)


@dataclass
class ToolProperty:
    name: str
    type: str
    description: Optional[str] = field(default="")
    configuration: dict[str, typing.Any] = field(default_factory=dict)
    parameters: list[ToolParameter] = field(default_factory=list)


@dataclass
class Prompty:
    """Prompty class to define the prompty

    Attributes
    ----------
    id : str
        The id of the prompty
    version : str
        The version of the prompty
    name : str
        The name of the prompty
    description : str
        The description of the prompty
    metadata : dict
        The metadata of the prompty
    base : str
        The base of the prompty
    basePrompty : Prompty
        The base prompty
    model : ModelSettings
        The model of the prompty
    inputs : dict[str, PropertySettings]
        The inputs of the prompty
    outputs : dict[str, PropertySettings]
        The outputs of the prompty
    template : TemplateSettings
        The template of the prompty
    tools:
        The tools of the prompty
    file : FilePath
        The file of the prompty
    content : Union[str, list[str], dict]
        The content of the prompty
    """

    # metadata
    id: str = field(default=uuid.uuid4().hex)
    version: str = field(default="")
    name: str = field(default="")
    description: str = field(default="")
    metadata: dict[str, typing.Any] = field(default_factory=dict)

    # future: undocumented template inheritance
    base: str = field(default="")
    basePrompty: Union["Prompty", None] = field(default=None)

    # model execution
    model: ModelProperty = field(default_factory=ModelProperty)

    # input / output
    inputs: list[InputProperty] = field(default_factory=list)
    outputs: list[OutputProperty] = field(default_factory=list)

    # tools
    tools: list[ToolProperty] = field(default_factory=list)

    # template
    template: TemplateProperty = field(default_factory=TemplateProperty)

    file: Union[str, Path] = field(default="")
    content: Union[str, list[str], dict] = field(default="")

    def get_input(self, name: str) -> InputProperty:
        """Get the property of the prompty

        Parameters
        ----------
        name : str
            The name of the property

        Returns
        -------
        InputProperty
            The property of the prompty
        """
        for i in self.inputs:
            if i.name == name:
                return i
        raise ValueError(f"Property {name} not found")

    def get_output(self, name: str) -> OutputProperty:
        """Get the output property of the prompty

        Parameters
        ----------
        name : str
            The name of the property

        Returns
        -------
        OutputProperty
            The property of the prompty
        """

        for i in self.outputs:
            if i.name == name:
                return i
        raise ValueError(f"Property {name} not found")

    def to_safe_dict(self) -> dict[str, typing.Any]:
        d: dict[str, typing.Any] = {}
        for items in fields(self):
            k = items.name
            v = getattr(self, k)
            if v != "" and v != {} and v != [] and v is not None:
                if k == "model":
                    d[k] = asdict(self.model)
                elif k == "template":
                    d[k] = asdict(self.template)
                elif k == "inputs" or k == "outputs":
                    d[k] = copy.deepcopy(v)
                elif k == "file":
                    d[k] = (
                        str(self.file.as_posix())
                        if isinstance(self.file, Path)
                        else self.file
                    )
                elif k == "tools":
                    d[k] = [asdict(t) for t in v]
                elif k == "basePrompty":
                    # no need to serialize basePrompty
                    continue

                else:
                    d[k] = v
        return d

    def get_sample(self) -> dict[str, typing.Any]:
        sample = {}
        for input in self.inputs:
            if input.sample:
                sample[input.name] = input.sample
            elif input.default:
                sample[input.name] = input.default
        return sample

    def merge_tools(self, tools: list[ToolProperty]) -> None:
        self.tools = [*self.tools, *tools]

    @staticmethod
    def load_tools(tools: list[dict]) -> list[ToolProperty]:
        loaded_tools = []

        for t in tools:
            configuration = t.pop("configuration") if "configuration" in t else {}
            params = t.pop("parameters") if "parameters" in t else []
            parameters: dict[str, ToolParameter] = {}
            if isinstance(params, dict):
                # if parameters is a dict, convert to list of ToolParameter
                parameters = {
                    k: ToolParameter(name=k, **v) for k, v in params.items()
                }
            elif isinstance(params, list):
                # if parameters is a list, convert to list of ToolParameter
                parameters = {
                    p["name"]: ToolParameter(**p) for p in params
                }
            elif params:
                raise ValueError("Parameters must be a list or dict")

            # hoist params from config if they exist
            if "parameters" in configuration:
                params = configuration.pop("parameters")
                if isinstance(params, dict):
                    for k, v in params.items():
                        if k not in parameters:
                            parameters[k] = ToolParameter(name=k, **v)
                        else:
                            raise ValueError(
                                f"Duplicate parameter {k} in configuration and parameters"
                            )
                elif isinstance(params, list):
                    for p in params:
                        if p["name"] not in parameters:
                            parameters[p["name"]] = ToolParameter(**p)
                        else:
                            raise ValueError(
                                f"Duplicate parameter {p['name']} in configuration and parameters"
                            )
                else:
                    raise ValueError("Parameters must be a list or dict")

            if t["type"] == "function" and parameters == {}:
                # if function, need to have parameters
                raise ValueError("Function tools must have parameters")

            loaded_tools.append(ToolProperty(**t, parameters=[*parameters.values()], configuration=configuration))

        return loaded_tools

    @staticmethod
    def load_input_property(name: str, value: typing.Any) -> InputProperty:

        # if a dict, need to check if it's a InputProperty
        if isinstance(value, dict):
            # check if dict is a InputProperty
            # needs to contain subset of type, default,
            # sample, sanitize, description
            if any([f.name in value for f in fields(InputProperty)]):
                ip = InputProperty(**value)
                if ip.name == "":
                    ip.name = name
                return ip
            # otherwise, assume it's a sample value
            else:
                return InputProperty(type=get_json_type(type(value)), sample=value, name=name)
        else:
            return InputProperty(type=get_json_type(type(value)), sample=value, name=name)

    @staticmethod
    def load_output_property(name: str, value: typing.Any) -> OutputProperty:
        # if a dict, need to check if it's a PropertySettings
        if isinstance(value, dict):
            # check if dict is a OutputProperty
            # needs to contain subset of type, default,
            # sample, sanitize, description
            if any([f.name in value for f in fields(OutputProperty)]):
                op = OutputProperty(**value)
                if op.name == "":
                    op.name = name
                return op
            # otherwise, assume it's a sample value
            else:
                return OutputProperty(type=get_json_type(type(value)), name=name)
        else:
            return OutputProperty(type=get_json_type(type(value)), name=name)

    @staticmethod
    def load_raw(
        attributes: dict, content: str, p: Path, global_config: dict
    ) -> "Prompty":
        if "model" not in attributes:
            attributes["model"] = {}

        # pull model settings out of attributes
        try:
            model_props = attributes.pop("model")
            if "configuration" in model_props:
                warnings.warn(
                    "Model configuration is deprecated, use connection instead",
                    DeprecationWarning,
                )
                model_props["connection"] = model_props.pop("configuration")

            if "parameters" in model_props:
                warnings.warn(
                    "Model parameters is deprecated, use options instead",
                    DeprecationWarning,
                )
                model_props["options"] = model_props.pop("parameters")

            # load connection settings
            if "connection" not in model_props:
                model_props["connection"] = global_config
            else:
                model_props["connection"] = param_hoisting(
                    model_props["connection"],
                    global_config,
                )

            model = ModelProperty(**model_props)
        except Exception as e:
            raise ValueError(f"Error in model settings: {e}")

        # pull template settings
        try:
            if "template" in attributes:
                t = attributes.pop("template")
                if "type" in t:
                    warnings.warn(
                        "Template type is deprecated, use format instead",
                        DeprecationWarning,
                    )
                    t["format"] = t.pop("type")

                if isinstance(t, dict):
                    template = TemplateProperty(**t)
                # has to be a string denoting the type
                else:
                    template = TemplateProperty(format=t, parser="prompty")
            else:
                template = TemplateProperty(format="jinja2", parser="prompty")
        except Exception as e:
            raise ValueError(f"Error in template loader: {e}")

        # formalize inputs and outputs
        inputs: dict[str, InputProperty] = {}
        if "inputs" in attributes:
            raw_inputs = attributes.pop("inputs")
            if isinstance(raw_inputs, list):
                inputs = {
                    # name should be in list item
                    i["name"]: Prompty.load_input_property(i["name"], i)
                    for i in raw_inputs
                }
            elif isinstance(raw_inputs, dict):
                inputs = {
                    k: Prompty.load_input_property(k, v) for (k, v) in raw_inputs.items()
                }
            else:
                raise ValueError("Inputs must be a list or dict")

        outputs: dict[str, OutputProperty] = {}
        if "outputs" in attributes:
            raw_outputs = attributes.pop("outputs")
            if isinstance(raw_outputs, list):
                outputs = {
                    # name should be in list item
                    i["name"]: Prompty.load_output_property("", i)
                    for i in raw_outputs
                }
            elif isinstance(raw_outputs, dict):
                outputs = {
                    k: Prompty.load_output_property(k, v) for (k, v) in raw_outputs.items()
                }
            else:
                raise ValueError("Outputs must be a list or dict")

        tools = []
        if "tools" in attributes:
            tools_attribute = attributes.pop("tools")
            if isinstance(tools_attribute, list):
                tools = Prompty.load_tools(tools_attribute)

        # infer input types
        # DEPRECATED: use inputs instead of sample
        if "sample" in attributes:
            warnings.warn(
                "Sample is deprecated, use inputs instead", DeprecationWarning
            )
            sample = attributes.pop("sample")
            for k, v in sample.items():
                # implicit input
                # check if k is in inputs
                if k not in inputs:
                    # infer v type to json type
                    inputs[k] = Prompty.load_input_property(k, v)
                else:
                    # explicit input (overwrite type?)
                    if inputs[k].type is None:
                        inputs[k].type = get_json_type(type(v))
                    # type mismatch
                    elif inputs[k].type != get_json_type(type(v)):
                        raise ValueError(
                            f"Type mismatch for input property {k}: input type ({inputs[k].type}) != sample type ({get_json_type(type(v))})"
                        )

        metadata = attributes.pop("metadata") if "metadata" in attributes else {}
        # DEPRECATED: authors and tags now in metadata
        if "authors" in attributes:
            warnings.warn(
                "Authors is deprecated, add authors to metadata instead", DeprecationWarning
            )
            authors = attributes.pop("authors")
            if isinstance(authors, list):
                metadata["authors"] = authors
            else:
                raise ValueError("Authors must be a list")
        if "tags" in attributes:
            warnings.warn(
                "Tags is deprecated, add tags to metadata instead", DeprecationWarning
            )
            tags = attributes.pop("tags")
            if isinstance(tags, list):
                metadata["tags"] = tags
            else:
                raise ValueError("Tags must be a list")

        prompty = Prompty(
            model=model,
            metadata=metadata,
            inputs=[*inputs.values()],
            outputs=[*outputs.values()],
            tools=tools,
            template=template,
            content=content,
            file=p,
            **attributes,
        )

        # setting template scratch pad
        prompty.template.content = prompty.content

        return prompty

    @staticmethod
    def hoist_base_prompty(top: "Prompty", base: "Prompty") -> "Prompty":
        top.name = base.name if top.name == "" else top.name
        top.description = base.description if top.description == "" else top.description
        top.metadata = param_hoisting(top.metadata, base.metadata)
        top.version = base.version if top.version == "" else top.version

        top.model.api = base.model.api if top.model.api == "" else top.model.api
        top.model.connection = param_hoisting(
            top.model.connection, base.model.connection
        )
        top.model.options = param_hoisting(top.model.options, base.model.options)

        top.basePrompty = base

        # TODO: Hoist tools

        return top

    @staticmethod
    def _process_file(file: str, parent: Path) -> typing.Any:
        f = Path(parent / Path(file)).resolve().absolute()
        if f.exists():
            items = load_json(f)
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
    async def _process_file_async(file: str, parent: Path) -> typing.Any:
        f = Path(parent / Path(file)).resolve().absolute()
        if f.exists():
            items = await load_json_async(f)
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
    def _process_env(
        variable: str, env_error=True, default: Union[str, None] = None
    ) -> typing.Any:
        if variable in os.environ.keys():
            return os.environ[variable]
        else:
            if default:
                return default
            if env_error:
                raise ValueError(f"Variable {variable} not found in environment")

            return ""

    @staticmethod
    def normalize(attribute: typing.Any, parent: Path, env_error=True) -> typing.Any:
        if isinstance(attribute, str):
            attribute = attribute.strip()
            if attribute.startswith("${") and attribute.endswith("}"):
                # check if env or file
                variable = attribute[2:-1].split(":")
                if variable[0] == "env" and len(variable) > 1:
                    return Prompty._process_env(
                        variable[1],
                        env_error,
                        variable[2] if len(variable) > 2 else None,
                    )
                elif variable[0] == "file" and len(variable) > 1:
                    return Prompty._process_file(variable[1], parent)
                else:
                    raise ValueError(f"Invalid attribute format ({attribute})")
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

    @staticmethod
    async def normalize_async(
        attribute: typing.Any, parent: Path, env_error=True
    ) -> typing.Any:
        if isinstance(attribute, str):
            attribute = attribute.strip()
            if attribute.startswith("${") and attribute.endswith("}"):
                # check if env or file
                variable = attribute[2:-1].split(":")
                if variable[0] == "env" and len(variable) > 1:
                    return Prompty._process_env(
                        variable[1],
                        env_error,
                        variable[2] if len(variable) > 2 else None,
                    )
                elif variable[0] == "file" and len(variable) > 1:
                    return await Prompty._process_file_async(variable[1], parent)
                else:
                    raise ValueError(f"Invalid attribute format ({attribute})")
            else:
                return attribute
        elif isinstance(attribute, list):
            return [await Prompty.normalize_async(value, parent) for value in attribute]
        elif isinstance(attribute, dict):
            return {
                key: await Prompty.normalize_async(value, parent)
                for key, value in attribute.items()
            }
        else:
            return attribute


def param_hoisting(
    top: dict[str, typing.Any],
    bottom: dict[str, typing.Any],
    top_key: Union[str, None] = None,
) -> dict[str, typing.Any]:
    if top_key:
        new_dict = {**top[top_key]} if top_key in top else {}
    else:
        new_dict = {**top}
    for key, value in bottom.items():
        if key not in new_dict:
            new_dict[key] = value
    return new_dict


class PromptyStream(Iterator):
    """PromptyStream class to iterate over LLM stream.
    Necessary for Prompty to handle streaming data when tracing."""

    def __init__(self, name: str, iterator: Iterator):
        self.name = name
        self.iterator = iterator
        self.items: list[typing.Any] = []
        self.__name__ = "PromptyStream"

    def __iter__(self):
        return self

    def __next__(self):
        try:
            # enumerate but add to list
            o = self.iterator.__next__()
            self.items.append(o)
            return o

        except StopIteration:
            # StopIteration is raised
            # contents are exhausted
            if len(self.items) > 0:
                with Tracer.start("PromptyStream") as trace:
                    trace("signature", f"{self.name}.PromptyStream")
                    trace("inputs", "None")
                    trace("result", [to_dict(s) for s in self.items])

            raise StopIteration


class AsyncPromptyStream(AsyncIterator):
    """AsyncPromptyStream class to iterate over LLM stream.
    Necessary for Prompty to handle streaming data when tracing."""

    def __init__(self, name: str, iterator: AsyncIterator):
        self.name = name
        self.iterator = iterator
        self.items: list[typing.Any] = []
        self.__name__ = "AsyncPromptyStream"

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            # enumerate but add to list
            o = await self.iterator.__anext__()
            self.items.append(o)
            return o

        except StopAsyncIteration:
            # StopIteration is raised
            # contents are exhausted
            if len(self.items) > 0:
                with Tracer.start("AsyncPromptyStream") as trace:
                    trace("signature", f"{self.name}.AsyncPromptyStream")
                    trace("inputs", "None")
                    trace("result", [to_dict(s) for s in self.items])

            raise StopAsyncIteration
