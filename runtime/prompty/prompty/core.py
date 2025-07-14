import copy
import typing
import uuid
import warnings
from collections.abc import AsyncIterator, Iterator
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Callable, Literal, Optional, Union

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
    # used internally
    value: typing.Any = field(default=None)
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
    required: bool = field(default=True)
    enum: list[typing.Any] = field(default_factory=list)

    # for array types, items is a type of OutputProperty
    items: Optional["OutputProperty"] = field(default=None)
    # for object types, properties is a list of OutputProperty
    properties: list["OutputProperty"] = field(default_factory=list)


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
    options: dict = field(default_factory=dict)


@dataclass
class ToolParameter:
    name: str
    type: Literal["string", "number", "array", "object", "boolean"]
    description: str = field(default="")
    required: bool = field(default=False)
    enum: list[typing.Any] = field(default_factory=list)


@dataclass
class ToolProperty:
    id: str
    type: str
    description: Optional[str] = field(default="")
    options: dict[str, typing.Any] = field(default_factory=dict)
    # used internally for assigning funcs
    value: typing.Any = field(default=None)
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

    # yaml based instructions
    instructions: str = field(default="")
    additional_instructions: str = field(default="")

    # internal properties
    file: Union[str, Path] = field(default="")
    content: Union[str, list[str], dict] = field(default="")
    slots: list[dict[str, str]] = field(default_factory=list)

    def get_input(self, name: str) -> Union[InputProperty, None]:
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
        return None

    def get_tool(self, name: str) -> Union[ToolProperty, None]:
        """Get the property of the prompty

        Parameters
        ----------
        name : str
            The name of the property

        Returns
        -------
        ToolProperty
            The property of the prompty
        """
        for i in self.tools:
            if i.id == name:
                return i
        return None

    def set_input_value(self, name: str, value: typing.Any) -> None:
        """Set the value of the input property"""
        for i in self.inputs:
            if i.name == name:
                i.value = value
                return

        raise ValueError(f"Input {name} not found")

    def set_tool_value(self, name: str, value: typing.Any) -> None:
        """Set the value of the input property"""
        for i in self.tools:
            if i.id == name:
                i.value = value
                return

        raise ValueError(f"Tool {name} not found")

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
                    d[k] = str(self.file.as_posix()) if isinstance(self.file, Path) else self.file
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
            options = t.pop("options") if "options" in t else {}
            params = t.pop("parameters") if "parameters" in t else []
            parameters: dict[str, ToolParameter] = {}
            if isinstance(params, dict):
                # if parameters is a dict, convert to list of ToolParameter
                parameters = {k: ToolParameter(name=k, **v) for k, v in params.items()}
            elif isinstance(params, list):
                # if parameters is a list, convert to list of ToolParameter
                parameters = {p["name"]: ToolParameter(**p) for p in params}
            elif params:
                raise ValueError("Parameters must be a list or dict")

            # hoist params from config if they exist
            if "parameters" in options:
                params = options.pop("parameters")
                if isinstance(params, dict):
                    for k, v in params.items():
                        if k not in parameters:
                            parameters[k] = ToolParameter(name=k, **v)
                        else:
                            raise ValueError(f"Duplicate parameter {k} in options and parameters")
                elif isinstance(params, list):
                    for p in params:
                        if p["name"] not in parameters:
                            parameters[p["name"]] = ToolParameter(**p)
                        else:
                            raise ValueError(f"Duplicate parameter {p['name']} in configuration and parameters")
                else:
                    raise ValueError("Parameters must be a list or dict")

            if t["type"] == "function" and parameters == {}:
                # if function, need to have parameters
                raise ValueError("Function tools must have parameters")

            loaded_tools.append(ToolProperty(**t, parameters=[*parameters.values()], options=options))

        return loaded_tools

    @staticmethod
    def load_property(
        value: typing.Any,
        cls: type[typing.Any],
        default: Union[Callable[[], dict[str, typing.Any]], None] = None,
    ) -> dict[str, typing.Any]:

        if isinstance(value, dict):
            # check for minimal set of properties
            if "type" not in value:
                if "sample" in value:
                    # if sample is present, type is not required
                    value["type"] = get_json_type(type(value["sample"]))
                else:
                    raise ValueError(f"{cls.__name__} type is required or must be inferred from sample")
            return {**value}
        else:
            if default is not None:
                return {**default()}
            else:
                raise ValueError(f"{cls.__name__} parameters mismatch")

    @staticmethod
    def load_collection_property(
        values: Union[dict, list],
        materialize: Callable[[str, typing.Any], dict[str, typing.Any]],
        error_message: str = "",
    ) -> list[dict[str, typing.Any]]:
        if isinstance(values, list):
            return [materialize("", v) for v in values]
        elif isinstance(values, dict):
            return [materialize(k, v) for k, v in values.items()]
        else:
            if error_message == "":
                error_message = f"Collection must be a list or dict, got {type(values)}"
            else:
                error_message = f"{error_message}, got {type(values)}"
            raise ValueError(error_message)

    @staticmethod
    def load_input_property(name: str, value: typing.Any) -> dict[str, typing.Any]:

        def to_dict() -> dict[str, typing.Any]:
            return {
                "type": get_json_type(type(value)),
                "sample": value,
                "name": name,
            }

        prop = Prompty.load_property(value, InputProperty, to_dict)
        if "name" not in prop or prop["name"] == "":
            prop["name"] = name

        return prop

    @staticmethod
    def load_output_property(name: str, value: typing.Any) -> dict[str, typing.Any]:

        def to_dict() -> dict[str, typing.Any]:
            return {
                "type": get_json_type(type(value)),
                "name": name,
            }

        prop = Prompty.load_property(value, OutputProperty, to_dict)
        if "name" not in prop or prop["name"] == "":
            prop["name"] = name

        return prop

    @staticmethod
    def load_tool_param(name: str, value: typing.Any) -> dict[str, typing.Any]:

        prop = Prompty.load_property(value, ToolParameter)
        if "name" not in prop or prop["name"] == "":
            prop["name"] = name

        return prop

    @staticmethod
    def load_tool(id: str, tool: dict[str, typing.Any]) -> dict[str, typing.Any]:
        options = tool.pop("options") if "options" in tool else {}
        parameters = Prompty.load_collection_property(
            tool.pop("parameters") if "parameters" in tool else [],
            Prompty.load_tool_param,
            "Tool parameters must be a list or dict",
        )

        if "parameters" in options:
            params = Prompty.load_collection_property(
                options.pop("parameters"),
                Prompty.load_tool_param,
                "Tool parameters must be a list or dict",
            )
            parameters = [*parameters, *params]

        t = {
            **tool,
            "options": options,
            "parameters": parameters,
        }

        if "id" not in t:
            t["id"] = id

        return t

    @staticmethod
    def load_manifest(attributes: dict, content: str, global_config: dict) -> dict[str, typing.Any]:

        prompty: dict[str, typing.Any] = {}

        if "base" in attributes:
            attributes.pop("base")
            warnings.warn("base prompty is currently not supported", DeprecationWarning)

        if "model" not in attributes:
            prompty["model"] = {}

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

        prompty["model"] = model_props

        # pull template settings

        if "template" in attributes:
            t = attributes.pop("template")
            if "type" in t:
                warnings.warn(
                    "Template type is deprecated, use format instead",
                    DeprecationWarning,
                )
                t["format"] = t.pop("type")

            if isinstance(t, dict):
                prompty["template"] = t
            # has to be a string denoting the type
            else:
                prompty["template"] = {"format": t, "parser": "prompty"}
        else:
            prompty["template"] = {"format": "jinja2", "parser": "prompty"}

        # formalize inputs and outputs
        inputs: list[dict[str, typing.Any]] = []
        if "inputs" in attributes:
            raw_inputs = attributes.pop("inputs")
            inputs = Prompty.load_collection_property(
                raw_inputs, Prompty.load_input_property, "Inputs must be a list or dict"
            )

        prompty["inputs"] = inputs

        outputs: list[dict[str, typing.Any]] = []
        if "outputs" in attributes:
            raw_outputs = attributes.pop("outputs")
            outputs = Prompty.load_collection_property(
                raw_outputs,
                Prompty.load_output_property,
                "Outputs must be a list or dict",
            )

        prompty["outputs"] = outputs

        tools = []
        if "tools" in attributes:
            tools_attribute = attributes.pop("tools")
            tools = Prompty.load_collection_property(tools_attribute, Prompty.load_tool, "Tools must be a list or dict")

        prompty["tools"] = tools

        if "sample" in attributes:
            raise ValueError("Sample is deprecated, use inputs instead")

        metadata = attributes.pop("metadata") if "metadata" in attributes else {}
        # DEPRECATED: authors and tags now in metadata
        if "authors" in attributes:
            warnings.warn(
                "Authors is deprecated, add authors to metadata instead",
                DeprecationWarning,
            )
            authors = attributes.pop("authors")
            if isinstance(authors, list):
                metadata["authors"] = authors
            else:
                raise ValueError("Authors must be a list")
        if "tags" in attributes:
            warnings.warn("Tags is deprecated, add tags to metadata instead", DeprecationWarning)
            tags = attributes.pop("tags")
            if isinstance(tags, list):
                metadata["tags"] = tags
            else:
                raise ValueError("Tags must be a list")

        prompty["metadata"] = metadata

        if isinstance(content, str):
            if "\n![thread]" in str(content):
                # if the content contains a thread, split it
                # into instructions and additional instructions
                instructions = content.split("\n![thread]")
                attributes["instructions"] = instructions[0]
                attributes["additional_instructions"] = instructions[1]
                # add thread input if it does not exist
                prompty["inputs"].append(
                    {"type": "array", "name": "thread", "description": "Agent Thread", "default": [], "strict": False}
                )
            else:
                attributes["instructions"] = content
                attributes["additional_instructions"] = ""

        return {**attributes, **prompty, "content": content}

    @staticmethod
    def _load_output(attributes: dict) -> OutputProperty:
        if "type" in attributes and attributes["type"] == "array":
            items = attributes.pop("items", [])
            attributes["items"] = Prompty._load_output({"name": "item", **items})

        elif "type" in attributes and attributes["type"] == "object":
            p = attributes.pop("properties", [])
            if isinstance(p, dict):
                p = [{"name": k, **v} for k, v in p.items()]

            properties = [Prompty._load_output(i) for i in p]
            attributes["properties"] = properties

        return OutputProperty(**attributes)

    @staticmethod
    def load_raw(attributes: dict, file: Path) -> "Prompty":
        # normalize outputs
        outputs = []
        if "outputs" in attributes:
            outputs = attributes.pop("outputs")
            if isinstance(outputs, dict):
                outputs = [{"name": k, **v} for k, v in outputs.items()]

        prompty = Prompty(
            model=ModelProperty(**attributes.pop("model")),
            inputs=[InputProperty(**i) for i in attributes.pop("inputs", [])],
            outputs=[Prompty._load_output(i) for i in outputs],
            tools=Prompty.load_tools(attributes.pop("tools", [])),
            template=TemplateProperty(**attributes.pop("template")),
            file=file,
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
        top.model.connection = param_hoisting(top.model.connection, base.model.connection)
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
                return {key: Prompty.normalize(value, parent) for key, value in items.items()}
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
                return {key: Prompty.normalize(value, parent) for key, value in items.items()}
            else:
                return items
        else:
            raise FileNotFoundError(f"File {file} not found")

    @staticmethod
    def extract_slots(root: str, attribute: typing.Any, acc: list[dict[str, str]]) -> list[dict[str, str]]:

        if isinstance(attribute, str):
            if attribute.startswith("${env"):
                variable = attribute[2:-1].split(":")
                if len(variable) < 2:
                    raise ValueError(f"Invalid environment/slot variable {attribute}")
                if len(variable) == 2:
                    return [{"name": root, "key": variable[1]}]
                else:
                    return [{"name": root, "key": variable[1], "default": variable[2]}]
            else:
                return acc

        if isinstance(attribute, list):
            params: list[dict[str, str]] = []
            for i, v in enumerate(attribute):
                if isinstance(v, dict) and "name" in v:
                    params = [
                        *params,
                        *Prompty.extract_slots(f'{root}.{v["name"]}', v, acc),
                    ]
                elif isinstance(v, dict) and "id" in v:
                    params = [
                        *params,
                        *Prompty.extract_slots(f'{root}.{v["id"]}', v, acc),
                    ]
                else:
                    params = [*params, *Prompty.extract_slots(f"{root}.{i}", v, acc)]

            return [*acc, *params]

        if isinstance(attribute, dict):
            params = []
            for k, v in attribute.items():
                params = [*params, *Prompty.extract_slots(f"{root}.{k}", v, acc)]
            return [*acc, *params]

        return acc

    @staticmethod
    def normalize(attribute: typing.Any, parent: Path) -> typing.Any:
        if isinstance(attribute, str):
            attribute = attribute.strip()
            if attribute.startswith("${file:") and attribute.endswith("}"):
                # check if env or file
                variable = attribute[2:-1].split(":")
                return Prompty._process_file(variable[1], parent)
            else:
                return attribute
        elif isinstance(attribute, list):
            return [Prompty.normalize(value, parent) for value in attribute]
        elif isinstance(attribute, dict):
            return {key: Prompty.normalize(value, parent) for key, value in attribute.items()}
        else:
            return attribute

    @staticmethod
    async def normalize_async(attribute: typing.Any, parent: Path) -> typing.Any:
        if isinstance(attribute, str):
            attribute = attribute.strip()
            if attribute.startswith("${file") and attribute.endswith("}"):
                variable = attribute[2:-1].split(":")
                return Prompty._process_file(variable[1], parent)
            else:
                return attribute
        elif isinstance(attribute, list):
            return [await Prompty.normalize_async(value, parent) for value in attribute]
        elif isinstance(attribute, dict):
            return {key: await Prompty.normalize_async(value, parent) for key, value in attribute.items()}
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
