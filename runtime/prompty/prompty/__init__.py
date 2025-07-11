import traceback
import typing
import uuid
from pathlib import Path
from typing import Union

from ._version import VERSION
from .core import (
    Prompty,
    param_hoisting,
)
from .invoker import InvokerFactory
from .parsers import PromptyChatParser
from .renderers import Jinja2Renderer, MustacheRenderer
from .tracer import trace
from .utils import (
    get_json_type,
    load_global_config,
    load_global_config_async,
    load_prompty,
    load_prompty_async,
)

__version__ = VERSION

InvokerFactory.add_renderer("jinja2", Jinja2Renderer)
InvokerFactory.add_renderer("mustache", MustacheRenderer)
InvokerFactory.add_parser("prompty.chat", PromptyChatParser)
InvokerFactory.add_parser("prompty.agent", PromptyChatParser)


def _load_with_slots(
    attributes: dict[str, typing.Any],
    content: str,
    global_config: dict[str, typing.Any],
    p: Path,
) -> Prompty:
    # load prompty dictionary from file
    prompty_dictionary = Prompty.load_manifest(attributes, content, global_config)

    slots = Prompty.extract_slots("manifest", prompty_dictionary, [])

    prompty = Prompty.load_raw(prompty_dictionary, p)
    prompty.slots = slots

    return prompty


@trace(description="Create a headless prompty object for programmatic use.")
def headless(
    api: str,
    content: Union[str, list[str], dict],
    connection: dict[str, typing.Any] = {},
    options: dict[str, typing.Any] = {},
    config: str = "default",
) -> Prompty:
    """Create a headless prompty object for programmatic use.

    Parameters
    ----------
    api : str
        The API to use for the model
    content : str | List[str] | dict
        The content to process
    configuration : Dict[str, any], optional
        The configuration to use, by default {}
    options : Dict[str, any], optional
        The options to use, by default {}
    config : str, optional
        The config to use, by default "default"

    Returns
    -------
    Prompty
        The headless prompty object

    Example
    -------
    >>> import prompty
    >>> p = prompty.headless(
            api="embedding",
            configuration={"type": "azure", "azure_deployment": "text-embedding-ada-002"},
            content="hello world",
        )
    >>> emb = prompty.execute(p)

    """

    # get caller's path (to get relative path for prompty.json)
    caller = Path(traceback.extract_stack()[-3].filename)

    attributes = {
        "template": {
            "format": "NOOP",
            "parser": "NOOP",
        },
        "model": {
            "api": api,
            "connection": connection,
            "options": options,
        },
    }

    # load global configuration
    global_config = load_global_config(caller.parent, config)
    prompty = _load_with_slots(attributes, "", global_config, caller.parent)
    prompty.content = content
    prompty.file = ""

    return prompty


@trace(description="Create a headless prompty object for programmatic use.")
async def headless_async(
    api: str,
    content: Union[str, list[str], dict],
    connection: dict[str, typing.Any] = {},
    options: dict[str, typing.Any] = {},
    config: str = "default",
) -> Prompty:
    """Create a headless prompty object for programmatic use.

    Parameters
    ----------
    api : str
        The API to use for the model
    content : str | List[str] | dict
        The content to process
    configuration : Dict[str, any], optional
        The configuration to use, by default {}
    options : Dict[str, any], optional
        The options to use, by default {}
    connection : str, optional
        The connection to use, by default "default"

    Returns
    -------
    Prompty
        The headless prompty object

    Example
    -------
    >>> import prompty
    >>> p = await prompty.headless_async(
            api="embedding",
            configuration={"type": "azure", "azure_deployment": "text-embedding-ada-002"},
            content="hello world",
        )
    >>> emb = prompty.execute(p)

    """

    # get caller's path (to get relative path for prompty.json)
    caller = Path(traceback.extract_stack()[-3].filename)

    attributes = {
        "template": {
            "format": "NOOP",
            "parser": "NOOP",
        },
        "model": {
            "api": api,
            "connection": connection,
            "options": options,
        },
    }

    # load global configuration
    global_config = await load_global_config_async(caller.parent, config)
    prompty = _load_with_slots(attributes, "", global_config, caller.parent)
    prompty.content = content
    prompty.file = ""

    return prompty


@trace(description="Load a prompty file.")
def load(prompty_file: str, config: str = "default") -> Prompty:
    """Load a prompty file.

    Parameters
    ----------
    prompty_file : str
        The path to the prompty file
    config : str, optional
        The config to use, by default "default"

    Returns
    -------
    Prompty
        The loaded prompty object

    Example
    -------
    >>> import prompty
    >>> p = prompty.load("prompts/basic.prompty")
    >>> print(p)
    """

    p = Path(prompty_file)
    if not p.is_absolute():
        # get caller's path (take into account trace frame)
        caller = Path(traceback.extract_stack()[-3].filename)
        p = Path(caller.parent / p).resolve().absolute()

    # load dictionary from prompty file
    matter = load_prompty(p)
    atttributes = matter.pop("attributes", {})
    # expand ${file} includes
    attributes = Prompty.normalize(atttributes, p.parent)

    # load global configuration
    global_config = load_global_config(p.parent, config)

    return _load_with_slots(attributes, matter["body"], global_config, p)


@trace(description="Load a prompty file.")
async def load_async(prompty_file: str, config: str = "default") -> Prompty:
    """Load a prompty file.

    Parameters
    ----------
    prompty_file : str
        The path to the prompty file
    config : str, optional
        The config to use, by default "default"

    Returns
    -------
    Prompty
        The loaded prompty object

    Example
    -------
    >>> import prompty
    >>> p = prompty.load("prompts/basic.prompty")
    >>> print(p)
    """

    p = Path(prompty_file)
    if not p.is_absolute():
        # get caller's path (take into account trace frame)
        caller = Path(traceback.extract_stack()[-3].filename)
        p = Path(caller.parent / p).resolve().absolute()

    # load dictionary from prompty file
    matter = await load_prompty_async(p)
    atttributes = matter.pop("attributes", {})
    # expand ${file} includes
    attributes = await Prompty.normalize_async(atttributes, p.parent)

    # load global configuration
    global_config = await load_global_config_async(p.parent, config)

    return _load_with_slots(attributes, matter["body"], global_config, p)


def _validate_inputs(prompt: Prompty, inputs: dict[str, typing.Any], merge_sample: bool = False):
    if merge_sample:
        inputs = param_hoisting(inputs, prompt.get_sample())

    clean_inputs = {}
    for input in prompt.inputs:
        # thread managed seperately
        if input.name == "thread":
            continue

        if input.name in inputs:
            if input.type != get_json_type(type(inputs[input.name])):
                raise ValueError(
                    f"Type mismatch for input property {input.name}: input type ({inputs[input.name].type}) != sample type ({input.type})"
                )
            clean_inputs[input.name] = inputs[input.name]
        else:
            if input.default is not None:
                clean_inputs[input.name] = input.default
            else:
                raise ValueError(f"Missing input property {input.name}")

    # check stra inputs
    invalid: list[str] = []
    for k, v in inputs.items():
        if prompt.get_input(k) is None:
            invalid.append(k)

    if len(invalid) > 0:
        raise ValueError(f"The following are not valid inputs: [{','.join(invalid)}]")

    return clean_inputs


@trace(description="Prepare the inputs for the prompt.")
def prepare(
    prompt: Prompty,
    inputs: dict[str, typing.Any] = {},
    merge_sample: bool = False,
):
    """Prepare the inputs for the prompt.

    Parameters
    ----------
    prompt : Prompty
        The prompty object
    inputs : Dict[str, any], optional
        The inputs to the prompt, by default {}

    Returns
    -------
    dict
        The prepared and hidrated template shaped to the LLM model

    Example
    -------
    >>> import prompty
    >>> p = prompty.load("prompts/basic.prompty")
    >>> inputs = {"name": "John Doe"}
    >>> content = prompty.prepare(p, inputs)
    """
    values = _validate_inputs(prompt, inputs, merge_sample)

    # add nonce for this run
    prompt.template.nonce = uuid.uuid4().hex

    render = InvokerFactory.run_renderer(prompt, values, prompt.content)
    result = InvokerFactory.run_parser(prompt, render)

    return result


@trace(description="Prepare the inputs for the prompt.")
async def prepare_async(
    prompt: Prompty,
    inputs: dict[str, typing.Any] = {},
    merge_sample: bool = False,
):
    """Prepare the inputs for the prompt.

    Parameters
    ----------
    prompt : Prompty
        The prompty object
    inputs : Dict[str, any], optional
        The inputs to the prompt, by default {}

    Returns
    -------
    dict
        The prepared and hidrated template shaped to the LLM model

    Example
    -------
    >>> import prompty
    >>> p = prompty.load("prompts/basic.prompty")
    >>> inputs = {"name": "John Doe"}
    >>> content = await prompty.prepare_async(p, inputs)
    """
    values = _validate_inputs(prompt, inputs, merge_sample)

    # add nonce for this run
    prompt.template.nonce = uuid.uuid4().hex

    render = await InvokerFactory.run_renderer_async(prompt, values, prompt.content)
    result = await InvokerFactory.run_parser_async(prompt, render)

    return result


@trace(description="Run the prepared Prompty content against the model.")
def run(
    prompt: Prompty,
    content: Union[dict, list, str],
    connection: dict[str, typing.Any] = {},
    options: dict[str, typing.Any] = {},
    slots: dict[str, typing.Any] = {},
    raw: bool = False,
):
    """Run the prepared Prompty content.

    Parameters
    ----------
    prompt : Prompty
        The prompty object
    content : dict | list | str
        The content to process
    connection : Dict[str, any], optional
        The connection to use, by default {}
    options : Dict[str, any], optional
        The options to use, by default {}
    raw : bool, optional
        Whether to skip processing, by default False

    Returns
    -------
    any
        The result of the prompt

    Example
    -------
    >>> import prompty
    >>> p = prompty.load("prompts/basic.prompty")
    >>> inputs = {"name": "John Doe"}
    >>> content = prompty.prepare(p, inputs)
    >>> result = prompty.run(p, content)
    """

    if connection != {}:
        prompt.model.connection = param_hoisting(connection, prompt.model.connection)

    if options != {}:
        prompt.model.options = param_hoisting(options, prompt.model.options)

    # map slots (if any keys are in the slots)
    if slots != {}:
        for item in prompt.slots:
            if item["key"] in slots:
                item["value"] = slots[item["key"]]

    result = InvokerFactory.run_executor(prompt, content)
    if not raw:
        result = InvokerFactory.run_processor(prompt, result)

    return result


@trace(description="Run the prepared Prompty content against the model.")
async def run_async(
    prompt: Prompty,
    content: Union[dict, list, str],
    connection: dict[str, typing.Any] = {},
    options: dict[str, typing.Any] = {},
    slots: dict[str, typing.Any] = {},
    raw: bool = False,
):
    """Run the prepared Prompty content.

    Parameters
    ----------
    prompt : Prompty
        The prompty object
    content : dict | list | str
        The content to process
    connection : Dict[str, any], optional
        The connection to use, by default {}
    options : Dict[str, any], optional
        The options to use, by default {}
    raw : bool, optional
        Whether to skip processing, by default False

    Returns
    -------
    any
        The result of the prompt

    Example
    -------
    >>> import prompty
    >>> p = prompty.load("prompts/basic.prompty")
    >>> inputs = {"name": "John Doe"}
    >>> content = await prompty.prepare_async(p, inputs)
    >>> result = await prompty.run_async(p, content)
    """

    if connection != {}:
        prompt.model.connection = param_hoisting(connection, prompt.model.connection)

    if options != {}:
        prompt.model.options = param_hoisting(options, prompt.model.options)

    # map slots (if any keys are in the slots)
    if slots != {}:
        for item in prompt.slots:
            if item["key"] in slots:
                item["value"] = slots[item["key"]]

    result = await InvokerFactory.run_executor_async(prompt, content)
    if not raw:
        result = await InvokerFactory.run_processor_async(prompt, result)

    return result


@trace(description="Execute a prompty")
def execute(
    prompt: Union[str, Path, Prompty],
    connection: dict[str, typing.Any] = {},
    options: dict[str, typing.Any] = {},
    inputs: dict[str, typing.Any] = {},
    env: dict[str, typing.Any] = {},
    raw: bool = False,
    merge_sample: bool = False,
    config_name: str = "default",
):
    """Execute a prompty.

    Parameters
    ----------
    prompt : Union[str, Prompty]
        The prompty object or path to the prompty file
    connection : Dict[str, any], optional
        The connection to use, by default {}
    options : Dict[str, any], optional
        The options to use, by default {}
    inputs : Dict[str, any], optional
        The inputs to the prompt, by default {}
    raw : bool, optional
        Whether to skip processing, by default False
    connection : str, optional
        The connection to use, by default "default"

    Returns
    -------
    any
        The result of the prompt

    Example
    -------
    >>> import prompty
    >>> inputs = {"name": "John Doe"}
    >>> result = prompty.execute("prompts/basic.prompty", inputs=inputs)
    """
    if isinstance(prompt, (str, Path)):
        path = Path(prompt)
        if not path.is_absolute():
            # get caller's path (take into account trace frame)
            caller = Path(traceback.extract_stack()[-3].filename)
            path = Path(caller.parent / path).resolve().absolute()
        prompt = load(str(path), config_name)

    # prepare content
    content = prepare(prompt, inputs, merge_sample)

    # run LLM model
    result = run(prompt, content, connection, options, env, raw)

    return result


@trace(description="Execute a prompty")
async def execute_async(
    prompt: Union[str, Path, Prompty],
    connection: dict[str, typing.Any] = {},
    options: dict[str, typing.Any] = {},
    inputs: dict[str, typing.Any] = {},
    env: dict[str, typing.Any] = {},
    raw: bool = False,
    merge_sample: bool = False,
    config_name: str = "default",
):
    """Execute a prompty.

    Parameters
    ----------
    prompt : Union[str, Prompty]
        The prompty object or path to the prompty file
    connection : Dict[str, any], optional
        The connection to use, by default {}
    options : Dict[str, any], optional
        The options to use, by default {}
    inputs : Dict[str, any], optional
        The inputs to the prompt, by default {}
    raw : bool, optional
        Whether to skip processing, by default False
    connection : str, optional
        The connection to use, by default "default"

    Returns
    -------
    any
        The result of the prompt

    Example
    -------
    >>> import prompty
    >>> inputs = {"name": "John Doe"}
    >>> result = await prompty.execute_async("prompts/basic.prompty", inputs=inputs)
    """
    if isinstance(prompt, (str, Path)):
        path = Path(prompt)
        if not path.is_absolute():
            # get caller's path (take into account trace frame)
            caller = Path(traceback.extract_stack()[-3].filename)
            path = Path(caller.parent / path).resolve().absolute()
        prompt = await load_async(str(path), config_name)

    # prepare content
    content = await prepare_async(prompt, inputs, merge_sample)

    # run LLM model
    result = await run_async(prompt, content, connection, options, env, raw)

    return result
