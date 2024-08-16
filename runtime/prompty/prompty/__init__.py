import json
import traceback
from pathlib import Path
from typing import Dict, List, Union

from prompty.tracer import trace
from prompty.core import (
    Frontmatter,
    InvokerException,
    InvokerFactory,
    ModelSettings,
    Prompty,
    PropertySettings,
    TemplateSettings,
    param_hoisting,
)

from .renderers import *
from .parsers import *


def load_global_config(
    prompty_path: Path = Path.cwd(), configuration: str = "default"
) -> Dict[str, any]:
    # prompty.config laying around?
    prompty_config = list(Path.cwd().glob("**/prompty.json"))

    # if there is one load it
    if len(prompty_config) > 0:
        # pick the nearest prompty.json
        config = sorted(
            [
                c
                for c in prompty_config
                if len(c.parent.parts) <= len(prompty_path.parts)
            ],
            key=lambda p: len(p.parts),
        )[-1]

        with open(config, "r") as f:
            c = json.load(f)
            if configuration in c:
                return c[configuration]
            else:
                raise ValueError(f'Item "{configuration}" not found in "{config}"')

    return {}


@trace(description="Create a headless prompty object for programmatic use.")
def headless(
    api: str,
    content: str | List[str] | dict,
    configuration: Dict[str, any] = {},
    parameters: Dict[str, any] = {},
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
    caller = Path(traceback.extract_stack()[-2].filename)
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
    matter = Frontmatter.read_file(p)
    attributes = matter["attributes"]
    content = matter["body"]

    # normalize attribute dictionary resolve keys and files
    attributes = Prompty.normalize(attributes, p.parent)

    # load global configuration
    global_config = Prompty.normalize(
        load_global_config(p.parent, configuration), p.parent
    )
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

    # recursive loading of base prompty
    if "base" in attributes:
        # load the base prompty from the same directory as the current prompty
        base = load(p.parent / attributes["base"])
        # hoist the base prompty's attributes to the current prompty
        model.api = base.model.api if model.api == "" else model.api
        model.configuration = param_hoisting(
            model.configuration, base.model.configuration
        )
        model.parameters = param_hoisting(model.parameters, base.model.parameters)
        model.response = param_hoisting(model.response, base.model.response)
        attributes["sample"] = param_hoisting(attributes, base.sample, "sample")

        p = Prompty(
            **attributes,
            model=model,
            inputs=inputs,
            outputs=outputs,
            template=template,
            content=content,
            file=p,
            basePrompty=base,
        )
    else:
        p = Prompty(
            **attributes,
            model=model,
            inputs=inputs,
            outputs=outputs,
            template=template,
            content=content,
            file=p,
        )
    return p

@trace(description="Prepare the inputs for the prompt.")
def prepare(
    prompt: Prompty,
    inputs: Dict[str, any] = {},
):
    """ Prepare the inputs for the prompt.

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

    if prompt.template.type == "NOOP":
        render = prompt.content
    else:
        # render
        renderer = InvokerFactory.create_renderer(prompt.template.type, prompt)
        render = renderer(inputs)

    if prompt.template.parser == "NOOP":
        result = render
    else:
        # parse [parser].[api]
        parser = InvokerFactory.create_parser(
            f"{prompt.template.parser}.{prompt.model.api}", prompt
        )
        result = parser(render)

    return result

@trace(description="Run the prepared Prompty content against the model.")
def run(
    prompt: Prompty,
    content: dict | list | str,
    configuration: Dict[str, any] = {},
    parameters: Dict[str, any] = {},
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

    invoker_type = prompt.model.configuration["type"]

    # invoker registration check
    if not InvokerFactory.has_invoker("executor", invoker_type):
        raise InvokerException(
            f"{invoker_type} Invoker has not been registered properly.", invoker_type
        )

    # execute
    executor = InvokerFactory.create_executor(invoker_type, prompt)
    result = executor(content)

    # skip?
    if not raw:
        # invoker registration check
        if not InvokerFactory.has_invoker("processor", invoker_type):
            raise InvokerException(
                f"{invoker_type} Invoker has not been registered properly.", invoker_type
            )
        
        # process
        processor = InvokerFactory.create_processor(invoker_type, prompt)
        result = processor(result)

    return result

@trace(description="Execute a prompty")
def execute(
    prompt: Union[str, Prompty],
    configuration: Dict[str, any] = {},
    parameters: Dict[str, any] = {},
    inputs: Dict[str, any] = {},
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
    if isinstance(prompt, str):
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
