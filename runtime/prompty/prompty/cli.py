import os
import json
import click
import importlib

from pathlib import Path
from pydantic import BaseModel

import prompty
from prompty.tracer import trace, PromptyTracer, console_tracer, Tracer
from dotenv import load_dotenv

load_dotenv()


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


@trace
def chat_mode(prompt_path: str):
    W = "\033[0m"  # white (normal)
    R = "\033[31m"  # red
    G = "\033[32m"  # green
    O = "\033[33m"  # orange
    B = "\033[34m"  # blue
    P = "\033[35m"  # purple
    print(f"Executing {str(prompt_path)} in chat mode...")
    p = prompty.load(str(prompt_path))
    if "chat_history" not in p.sample:
        print(
            f"{R}{str(prompt_path)} needs to have a chat_history input to work in chat mode{W}"
        )
        return
    else:
        chat_history = p.sample["chat_history"]
        while True:
            user_input = input(f"{B}User:{W} ")
            if user_input == "exit":
                break
            chat_history.append({"role": "user", "content": user_input})
            # reloadable prompty file
            result = execute(prompt_path, inputs={"chat_history": chat_history})
            print(f"\n{G}Assistant:{W} {result}\n")
            chat_history.append({"role": "assistant", "content": result})
    print("Goodbye!")


@trace
def execute(prompt_path: str, raw=False):
    p = prompty.load(prompt_path)

    # load executor / processor types
    t = p.model.configuration["type"]
    t = t if "." in t else f"prompty.{t}"
    print(f"Loading {t}")
    try:
        importlib.import_module(t)

        result = prompty.execute(p, raw=raw)

        if issubclass(type(result), BaseModel):
            print(json.dumps(result.model_dump(), indent=4))
        elif isinstance(result, list):
            print(json.dumps([item.model_dump() for item in result], indent=4))
        else:
            print(result)
    except Exception as e:
        print(type(e).__qualname__, e)


@click.command()
@click.option("--source", "-s", required=True)
@click.option("--verbose", "-v", is_flag=True)
@click.option("--chat", "-c", is_flag=True)
@click.version_option()
def run(source, verbose, chat):
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
        execute(str(prompt_path), raw=verbose)


if __name__ == "__main__":
    chat_mode(source="./tests/prompts/basic.prompt")
