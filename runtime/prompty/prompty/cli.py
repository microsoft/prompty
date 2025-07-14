import importlib
import json
import os
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any, Optional

import click
from dotenv import load_dotenv

import prompty
from prompty.tracer import PromptyTracer, Tracer, console_tracer, trace


def normalize_path(p, create_dir=False) -> Path:
    path = Path(p)
    if not path.is_absolute():
        path = Path(os.getcwd()).joinpath(path).absolute().resolve()
    else:
        path = path.absolute().resolve()

    if create_dir:
        if not path.exists():
            print(f"Creating directory {str(path)}")
            os.makedirs(str(path))

    return path


def dynamic_import(module: str):
    # built in modules
    if module == "azure" or module == "azure_openai":
        t = "prompty.azure"
    elif module == "serverless":
        t = "prompty.serverless"
    elif module == "openai":
        t = "prompty.openai"
    else:
        t = module

    print(f"Loading invokers from {t}")
    importlib.import_module(t)


@trace
def chat_mode(prompt_path: str):
    W = "\033[0m"  # white (normal)
    R = "\033[31m"  # red
    G = "\033[32m"  # green
    # O = "\033[33m"  # orange
    B = "\033[34m"  # blue
    # P = "\033[35m"  # purple
    print(f"Executing {str(prompt_path)} in chat mode...")
    p = prompty.load(str(prompt_path))
    if p.get_input("thread") is None:
        print(f"{R}{str(prompt_path)} needs to have a thread input to work in chat mode{W}")
        return

    if p.get_input("query") is None:
        print(f"{R}{str(prompt_path)} needs to have a query input to work in chat mode{W}")
        return

    else:

        try:
            # load executor / processor types
            dynamic_import(p.model.connection["type"])
            while True:
                user_input = input(f"\n{B}User:{W} ")
                if user_input == "exit":
                    break
                # reloadable prompty file
                result = prompty.execute(p, inputs={"query": user_input}, merge_sample=True)
                print(f"\n{G}Assistant:{W} {result}")
        except Exception as e:
            print(f"{type(e).__qualname__}: {e}")

    print(f"\n{R}Goodbye!{W}\n")


def execute(prompt_path: str, inputs: Optional[dict[str, Any]] = None, raw=False):
    name = Path(prompt_path).name.lower().replace(" ", "-").replace(".prompty", "")
    inputs = inputs or {}
    with Tracer.start(name) as trace:
        trace("type", "cli")
        trace("signature", "prompty.cli.execute")
        trace("description", "Prompty CLI Execution")
        trace("inputs", {"prompt_path": prompt_path, "inputs": inputs})

        p = prompty.load(prompt_path)

        try:
            # load executor / processor types
            dynamic_import(p.model.connection["type"])

            result = prompty.execute(p, inputs=inputs, raw=raw, merge_sample=True)
            trace("result", result)
            if is_dataclass(result) and not isinstance(result, type):
                print("\n", json.dumps(asdict(result), indent=4), "\n")
            elif isinstance(result, list):
                print("\n", json.dumps([asdict(item) for item in result], indent=4), "\n")
            elif isinstance(result, dict):
                print("\n", json.dumps(result, indent=4), "\n")
            else:
                print("\n", result, "\n")
        except Exception as e:
            print(f"{type(e).__qualname__}: {e}", "\n")


def _attributes_to_dict(ctx: click.Context, attribute: click.Option, attributes: tuple[str, ...]) -> dict[str, str]:
    """Click callback that converts attributes specified in the form `key=value` to a
    dictionary"""
    result = {}
    for arg in attributes:
        k, v = arg.split("=")
        if k in result:
            raise click.BadParameter(f"Attribute {k!r} is specified twice")
        if v == "@-":
            v = click.get_text_stream("stdin").read()
        if v.startswith("@"):
            v = Path(v[1:]).read_text()
        result[k] = v

    return result


@click.command(
    epilog="""
\b
INPUTS: key=value pairs
    The values can come from:
    - plain strings - e.g.: question="Does it have windows?"
    - files - e.g.: question=@question.txt
    - stdin - e.g.: question=@-

For more information, visit https://prompty.ai/
"""
)
@click.option("--source", "-s", required=True)
@click.option("--env", "-e", required=False)
@click.option("--verbose", "-v", is_flag=True)
@click.option("--chat", "-c", is_flag=True)
@click.argument("inputs", nargs=-1, callback=_attributes_to_dict)
@click.version_option()
def run(source, env, verbose, chat, inputs):
    # load external env file
    if env:
        print(f"Loading environment variables from {env}")
        load_dotenv(env)

    prompt_path = normalize_path(source)
    if not prompt_path.exists():
        print(f"{str(prompt_path)} does not exist")
        return

    if verbose:
        Tracer.add("console", console_tracer)

    ptrace = PromptyTracer()
    Tracer.add("prompty", ptrace.tracer)

    if chat:
        chat_mode(str(prompt_path))
    else:
        execute(str(prompt_path), inputs=inputs)


if __name__ == "__main__":
    chat_mode(source="./tests/prompts/basic.prompt")
