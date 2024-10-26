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

Notice that there is also the ability to do variable replacement in the prompty frontmatter. This allows for the prompt to be more dynamic and reusable across different scenarios.
In general, the replacement syntax is `${type:variable:default}` where `type` is the type of replacement, `variable` is the variable to replace, and `default` is the default value if the variable is not found.
The two types are `env` and `file`. `env` is used to replace the variable with an environment variable and `file` is used to replace the variable with the contents of a json file.

## Prompty.Core Package
The `Prompty.Core` package contains the core functionality for working with Prompty files. It contains the basic loaders as well as the Invocation API for executing prompts.
The package _only_ contains the load, render, and parse functionality as the actual execution and processing of the prompts is done by packages that build on this core package.


Simple usage example:

```csharp
using Prompty.Core;

// auto registers all invokers
InvokerFactory.AutoDiscovery();

// loads prompty file
var prompt = Prompty.Load("path/to/prompty/file");

// generates the message array
var messages = prompt.Prepare(new { firstName = "Jane", lastName = "Doe", question = "What is the meaning of life?" });
```

The messages array can then be used to send to the appropriate invoker for execution.

## Using Prompty Configuration
Prompty configuration is a way to override prompty frontmatter settings. The configuration is stored in a `prompty.json` anywhere in the project directory. 
If there are multiple configuration files, the configuration "closest" to the prompty file is used. Here's an example of a `prompty.json` file:


```json
{
  "default": {
    "type": "azure",
    "api_version": "2023-12-01-preview",
    "azure_endpoint": "${env:AZURE_OPENAI_ENDPOINT}",
    "azure_deployment": "${env:AZURE_OPENAI_DEPLOYMENT:gpt-35-turbo}"
  }
}
```

In this case, the `default` configuration is used for all prompty files that do not have a configuration specified in their frontmatter (if the `prompty.json` file exists). The loader
allows for other configurations to be specified in the `prompty.json` file as well. The configuration can be passed in as a parameter to the `Load` method:

```csharp
var prompty = Prompty.Load(path, "myotherconfig");
```

## Contributing
We welcome contributions to the Prompty project! This community led project is open to all contributors. The project can be found on [GitHub](https://github.com/Microsoft/prompty).