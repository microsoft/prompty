
Prompty is an asset class and format for LLM prompts designed to enhance observability, understandability, and portability for developers. The primary goal is to accelerate the developer inner loop of prompt engineering and prompt source management in a cross-language and cross-platform implementation.

The file format has a supporting toolchain with a VS Code extension and runtimes in multiple programming languages to simplify and accelerate your AI application development.

The tooling comes together in three ways: the *prompty file asset*, the *VS Code extension tool*, and *runtimes* in multiple programming languges.

## The Prompty File Format
Prompty is a language agnostic prompt asset for creating prompts and engineering the responses. Learn more about the format [here](https://prompty.ai/docs/prompty-file-spec).

Examples prompty file:
```markdown
---
name: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
authors:
  - sethjuarez
  - jietong
model:
  api: chat
  configuration:
    azure_deployment: gpt-35-turbo
sample:
  firstName: Jane
  lastName: Doe
  question: What is the meaning of life?
---
system:
You are an AI assistant who helps people find information.
As the assistant, you answer questions briefly, succinctly, 
and in a personable manner using markdown and even add some personal flair with appropriate emojis.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to their questions.
Use their name to address them in your responses.

user:
{{question}}
```


## The Prompty VS Code Extension
Run Prompty files directly in VS Code. This Visual Studio Code extension offers an intuitive prompt playground within VS Code to streamline the prompt engineering process. You can find the Prompty extension in the Visual Studio Code Marketplace.

Download the [VS Code extension here](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.prompty).


## Using this Prompty Runtime
The Python runtime is a simple way to run your prompts in Python. The runtime is available as a Python package and can be installed using pip.

```bash
pip install prompty
```

Simple usage example:

```python
import prompty

# execute the prompt
response = prompty.execute("path/to/prompty/file")

print(response)
```

## Using Tracing in Prompty
Prompty supports tracing to help you understand the execution of your prompts. The built-in tracing dumps the execution of the prompt to a file. 

```python
import prompty
from prompty.tracer import Trace, PromptyTracer

# add default tracer
Trace.add_tracerTrace.add_tracer("prompty", PromptyTracer("path/to/trace/dir"))

# execute the prompt
response = prompty.execute("path/to/prompty/file")

print(response)
```

You can also bring your own tracer by creating a `Tracer` class. 
Simple example:

```python
import prompty
from prompty.tracer import Tracer

class MyTracer(Tracer):

    def start(self, name: str) -> None:
        print(f"Starting {name}")

    def add(self, key: str, value: Any) -> None:
        print(f"Adding {key} with value {value}")

    def end(self) -> None:
        print("Ending")

# add your tracer
Trace.add_tracer("my_tracer", MyTracer())

# execute the prompt
response = prompty.execute("path/to/prompty/file")

```

To define your own tracer, you can subclass the `Tracer` class and implement the `start`, `add`, and `end` methods and then add it to the `Trace` instance. You can add as many tracers as you like - the will all of them will be called in order.

## CLI
The Prompty runtime also comes with a CLI tool that allows you to run prompts from the command line. The CLI tool is installed with the Python package.

```bash
prompty -s path/to/prompty/file
```

This will execute the prompt and print the response to the console. It also has default tracing enabled.

## Contributing
We welcome contributions to the Prompty project! This community led project is open to all contributors. The project cvan be found on [GitHub](https://github.com/Microsoft/prompty).
