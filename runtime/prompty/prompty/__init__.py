import traceback
import typing
from pathlib import Path
from typing import Union

from .core import (
    ModelSettings,
    Prompty,
    PropertySettings,
    TemplateSettings,
    param_hoisting,
)
from .invoker import InvokerFactory
from .parsers import PromptyChatParser
from .renderers import Jinja2Renderer, MustacheRenderer
from .tracer import trace
from .utils import (
    load_global_config,
    load_global_config_async,
    load_prompty,
    load_prompty_async,
)

InvokerFactory.add_renderer("jinja2", Jinja2Renderer)
InvokerFactory.add_renderer("mustache", MustacheRenderer)
InvokerFactory.add_parser("prompty.chat", PromptyChatParser)


@trace(description="Create a headless prompty object for programmatic use.")
def headless(
    api: str,
    content: Union[str, list[str], dict],
    configuration: dict[str, typing.Any] = {},
    parameters: dict[str, typing.Any] = {},
    connection: str = "default",
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
    parameters : Dict[str, any], optional
        The parameters to use, by default {}
    connection : str, optional
        The connection to use, by default "default"

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
    templateSettings = TemplateSettings(type="NOOP", parser="NOOP")
    modelSettings = ModelSettings(
        api=api,
        configuration=Prompty.normalize(
            param_hoisting(
                configuration, load_global_config(caller.parent, connection)
            ),
            caller.parent,
        ),
        parameters=parameters,
    )

    return Prompty(model=modelSettings, template=templateSettings, content=content)


@trace(description="Create a headless prompty object for programmatic use.")
async def headless_async(
    api: str,
    content: Union[str, list[str], dict],
    configuration: dict[str, typing.Any] = {},
    parameters: dict[str, typing.Any] = {},
    connection: str = "default",
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
    parameters : Dict[str, any], optional
        The parameters to use, by default {}
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
    templateSettings = TemplateSettings(type="NOOP", parser="NOOP")

    global_config = await load_global_config_async(caller.parent, connection)
    c = await Prompty.normalize_async(
        param_hoisting(configuration, global_config), caller.parent
    )

    modelSettings = ModelSettings(
        api=api,
        configuration=c,
        parameters=parameters,
    )

    return Prompty(model=modelSettings, template=templateSettings, content=content)


def _load_raw_prompty(attributes: dict, content: str, p: Path, global_config: dict):
    if "model" not in attributes:
        attributes["model"] = {}

    if "configuration" not in attributes["model"]:
        attributes["model"]["configuration"] = global_config
    else:
        attributes["model"]["configuration"] = param_hoisting(
            attributes["model"]["configuration"],
            global_config,
        )

    # pull model settings out of attributes
    try:
        model = ModelSettings(**attributes.pop("model"))
    except Exception as e:
        raise ValueError(f"Error in model settings: {e}")

    # pull template settings
    try:
        if "template" in attributes:
            t = attributes.pop("template")
            if isinstance(t, dict):
                template = TemplateSettings(**t)
            # has to be a string denoting the type
            else:
                template = TemplateSettings(type=t, parser="prompty")
        else:
            template = TemplateSettings(type="jinja2", parser="prompty")
    except Exception as e:
        raise ValueError(f"Error in template loader: {e}")

    # formalize inputs and outputs
    if "inputs" in attributes:
        try:
            inputs = {
                k: PropertySettings(**v) for (k, v) in attributes.pop("inputs").items()
            }
        except Exception as e:
            raise ValueError(f"Error in inputs: {e}")
    else:
        inputs = {}
    if "outputs" in attributes:
        try:
            outputs = {
                k: PropertySettings(**v) for (k, v) in attributes.pop("outputs").items()
            }
        except Exception as e:
            raise ValueError(f"Error in outputs: {e}")
    else:
        outputs = {}

    prompty = Prompty(
        model=model,
        inputs=inputs,
        outputs=outputs,
        template=template,
        content=content,
        file=p,
        **attributes
    )

    return prompty


@trace(description="Load a prompty file.")
def load(prompty_file: str, configuration: str = "default") -> Prompty:
    """Load a prompty file.

    Parameters
    ----------
    prompty_file : str
        The path to the prompty file
    configuration : str, optional
        The configuration to use, by default "default"

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

    attributes = matter["attributes"]
    content = matter["body"]

    # normalize attribute dictionary resolve keys and files
    attributes = Prompty.normalize(attributes, p.parent)

    # load global configuration
    global_config = Prompty.normalize(
        load_global_config(p.parent, configuration), p.parent
    )

    prompty = _load_raw_prompty(attributes, content, p, global_config)

    # recursive loading of base prompty
    if "base" in attributes:
        # load the base prompty from the same directory as the current prompty
        base = load(p.parent / attributes["base"])
        prompty = Prompty.hoist_base_prompty(prompty, base)

    return prompty


@trace(description="Load a prompty file.")
async def load_async(prompty_file: str, configuration: str = "default") -> Prompty:
    """Load a prompty file.

    Parameters
    ----------
    prompty_file : str
        The path to the prompty file
    configuration : str, optional
        The configuration to use, by default "default"

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

    attributes = matter["attributes"]
    content = matter["body"]

    # normalize attribute dictionary resolve keys and files
    attributes = await Prompty.normalize_async(attributes, p.parent)

    # load global configuration
    config = await load_global_config_async(p.parent, configuration)
    global_config = await Prompty.normalize_async(config, p.parent)

    prompty = _load_raw_prompty(attributes, content, p, global_config)

    # recursive loading of base prompty
    if "base" in attributes:
        # load the base prompty from the same directory as the current prompty
        base = await load_async(p.parent / attributes["base"])
        prompty = Prompty.hoist_base_prompty(prompty, base)

    return prompty


@trace(description="Prepare the inputs for the prompt.")
def prepare(
    prompt: Prompty,
    inputs: dict[str, typing.Any] = {},
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
    inputs = param_hoisting(inputs, prompt.sample)

    render = InvokerFactory.run_renderer(prompt, inputs, prompt.content)
    result = InvokerFactory.run_parser(prompt, render)

    return result


@trace(description="Prepare the inputs for the prompt.")
async def prepare_async(
    prompt: Prompty,
    inputs: dict[str, typing.Any] = {},
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
    inputs = param_hoisting(inputs, prompt.sample)

    render = await InvokerFactory.run_renderer_async(prompt, inputs, prompt.content)
    result = await InvokerFactory.run_parser_async(prompt, render)

    return result


@trace(description="Run the prepared Prompty content against the model.")
def run(
    prompt: Prompty,
    content: Union[dict, list, str],
    configuration: dict[str, typing.Any] = {},
    parameters: dict[str, typing.Any] = {},
    raw: bool = False,
):
    """Run the prepared Prompty content.

    Parameters
    ----------
    prompt : Prompty
        The prompty object
    content : dict | list | str
        The content to process
    configuration : Dict[str, any], optional
        The configuration to use, by default {}
    parameters : Dict[str, any], optional
        The parameters to use, by default {}
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

    if configuration != {}:
        prompt.model.configuration = param_hoisting(
            configuration, prompt.model.configuration
        )

    if parameters != {}:
        prompt.model.parameters = param_hoisting(parameters, prompt.model.parameters)

    result = InvokerFactory.run_executor(prompt, content)
    if not raw:
        result = InvokerFactory.run_processor(prompt, result)

    return result


@trace(description="Run the prepared Prompty content against the model.")
async def run_async(
    prompt: Prompty,
    content: Union[dict, list, str],
    configuration: dict[str, typing.Any] = {},
    parameters: dict[str, typing.Any] = {},
    raw: bool = False,
):
    """Run the prepared Prompty content.

    Parameters
    ----------
    prompt : Prompty
        The prompty object
    content : dict | list | str
        The content to process
    configuration : Dict[str, any], optional
        The configuration to use, by default {}
    parameters : Dict[str, any], optional
        The parameters to use, by default {}
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

    if configuration != {}:
        prompt.model.configuration = param_hoisting(
            configuration, prompt.model.configuration
        )

    if parameters != {}:
        prompt.model.parameters = param_hoisting(parameters, prompt.model.parameters)

    result = await InvokerFactory.run_executor_async(prompt, content)
    if not raw:
        result = await InvokerFactory.run_processor_async(prompt, result)

    return result


@trace(description="Execute a prompty")
def execute(
    prompt: Union[str, Prompty],
    configuration: dict[str, typing.Any] = {},
    parameters: dict[str, typing.Any] = {},
    inputs: dict[str, typing.Any] = {},
    raw: bool = False,
    config_name: str = "default",
):
    """Execute a prompty.

    Parameters
    ----------
    prompt : Union[str, Prompty]
        The prompty object or path to the prompty file
    configuration : Dict[str, any], optional
        The configuration to use, by default {}
    parameters : Dict[str, any], optional
        The parameters to use, by default {}
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
        prompt = load(path, config_name)

    # prepare content
    content = prepare(prompt, inputs)

    # run LLM model
    result = run(prompt, content, configuration, parameters, raw)

    return result


@trace(description="Execute a prompty")
async def execute_async(
    prompt: Union[str, Prompty],
    configuration: dict[str, typing.Any] = {},
    parameters: dict[str, typing.Any] = {},
    inputs: dict[str, typing.Any] = {},
    raw: bool = False,
    config_name: str = "default",
):
    """Execute a prompty.

    Parameters
    ----------
    prompt : Union[str, Prompty]
        The prompty object or path to the prompty file
    configuration : Dict[str, any], optional
        The configuration to use, by default {}
    parameters : Dict[str, any], optional
        The parameters to use, by default {}
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
        prompt = await load_async(path, config_name)

    # prepare content
    content = await prepare_async(prompt, inputs)

    # run LLM model
    result = await run_async(prompt, content, configuration, parameters, raw)

    return result
