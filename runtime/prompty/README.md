
Prompty is an asset class and format for LLM prompts designed to enhance observability, understandability, and portability for developers. The primary goal is to accelerate the developer inner loop of prompt engineering and prompt source management in a cross-language and cross-platform implementation.

The file format has a supporting toolchain with a VS Code extension and runtimes in multiple programming languages to simplify and accelerate your AI application development.

The tooling comes together in three ways: the *prompty file asset*, the *VS Code extension tool*, and *runtimes* in multiple programming languages.

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
    api_version: 2023-12-01-preview
    azure_endpoint: ${env:AZURE_OPENAI_ENDPOINT}
    azure_deployment: ${env:AZURE_OPENAI_DEPLOYMENT:gpt-35-turbo}
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
The Python runtime is a simple way to run your prompts in Python. The runtime is available as a Python package and can be installed using pip. Depending on the type of prompt you are running, you may need to install additional dependencies. The runtime is designed to be extensible and can be customized to fit your needs.

```bash
pip install prompty[azure]
```

Simple usage example:

```python
import prompty
# import invoker
import prompty.azure

# execute the prompt
response = prompty.execute("path/to/prompty/file")

print(response)
```

## Available Invokers
The Prompty runtime comes with a set of built-in invokers that can be used to execute prompts. These include:

- `azure`: Invokes the Azure OpenAI API
- `openai`: Invokes the OpenAI API
- `serverless`: Invokes serverless models (like the ones on GitHub) using the [Azure AI Inference client library](https://learn.microsoft.com/en-us/python/api/overview/azure/ai-inference-readme?view=azure-python-preview) (currently only key based authentication is supported with more managed identity support coming soon)


## Using Tracing in Prompty
Prompty supports tracing to help you understand the execution of your prompts. This functionality is customizable and can be used to trace the execution of your prompts in a way that makes sense to you. Prompty has two default traces built in: `console_tracer` and `PromptyTracer`. The `console_tracer` writes the trace to the console, and the `PromptyTracer` writes the trace to a JSON file. You can also create your own tracer by creating your own hook.

```python
import prompty
# import invoker
import prompty.azure
from prompty.tracer import trace, Tracer, console_tracer, PromptyTracer

# add console tracer
Tracer.add("console", console_tracer)

# add PromptyTracer
json_tracer = PromptyTracer(output_dir="path/to/output")
Tracer.add("console", json_tracer.tracer)

# execute the prompt
response = prompty.execute("path/to/prompty/file")

print(response)
```

You can also bring your own tracer by your own tracing hook. The `console_tracer` is the simplest example of a tracer. It writes the trace to the console.
This is what it looks like:

```python
@contextlib.contextmanager
def console_tracer(name: str) -> Iterator[Callable[[str, Any], None]]:
    try:
        print(f"Starting {name}")
        yield lambda key, value: print(f"{key}:\n{json.dumps(value, indent=4)}")
    finally:
        print(f"Ending {name}")

```

It uses a context manager to define the start and end of the trace so you can do whatever setup and teardown you need. The `yield` statement returns a function that you can use to write the trace. The `console_tracer` writes the trace to the console using the `print` function.

The `PromptyTracer` is a more complex example of a tracer. This tracer manages its internal state using a full class. Here's an example of the class based approach that writes each function trace to a JSON file:

```python
class SimplePromptyTracer:
    def __init__(self, output_dir: str):
        self.output_dir = output_dir
        self.tracer = self._tracer

    @contextlib.contextmanager
    def tracer(self, name: str) -> Iterator[Callable[[str, Any], None]]:
        trace = {}
        try:
            yield lambda key, value: trace.update({key: value})
        finally:
            with open(os.path.join(self.output_dir, f"{name}.json"), "w") as f:
                json.dump(trace, f, indent=4)
```

The tracing mechanism is supported for all of the prompty runtime internals and can be used to trace the execution of the prompt along with all of the paramters. There is also a `@trace` decorator that can be used to trace the execution of any function external to the runtime. This is provided as a facility to trace the execution of the prompt and whatever supporting code you have.

```python
import prompty
# import invoker
import prompty.azure
from prompty.tracer import trace, Tracer, PromptyTracer

json_tracer = PromptyTracer(output_dir="path/to/output")
Tracer.add("PromptyTracer", json_tracer.tracer)

@trace
def get_customer(customerId):
    return {"id": customerId, "firstName": "Sally", "lastName": "Davis"}

@trace
def get_response(customerId, prompt):
    customer = get_customer(customerId)

    result = prompty.execute(
        prompt,
        inputs={"question": question, "customer": customer},
    )
    return {"question": question, "answer": result}

```

In this case, whenever this code is executed, a `.tracy` file will be created in the `path/to/output` directory. This file will contain the trace of the execution of the `get_response` function, the execution of the `get_customer` function, and the prompty internals that generated the response.

## OpenTelemetry Tracing
You can add OpenTelemetry tracing to your application using the same hook mechanism. In your application, you might create something like `trace_span` to trace the execution of your prompts:

```python
from opentelemetry import trace as oteltrace

_tracer = "prompty"

@contextlib.contextmanager
def trace_span(name: str):
    tracer = oteltrace.get_tracer(_tracer)
    with tracer.start_as_current_span(name) as span:
        yield lambda key, value: span.set_attribute(
            key, json.dumps(value).replace("\n", "")
        )

# adding this hook to the prompty runtime
Tracer.add("OpenTelemetry", trace_span)

```

This will produce spans during the execution of the prompt that can be sent to an OpenTelemetry collector for further analysis.

## CLI
The Prompty runtime also comes with a CLI tool that allows you to run prompts from the command line. The CLI tool is installed with the Python package.

```bash
prompty -s path/to/prompty/file -e .env
```

This will execute the prompt and print the response to the console. If there are any environment variables the CLI should take into account, you can pass those in via the `-e` flag. It also has default tracing enabled.

## Contributing
We welcome contributions to the Prompty project! This community led project is open to all contributors. The project can be found on [GitHub](https://github.com/Microsoft/prompty).
