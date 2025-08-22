# Model

Model for defining the structure and behavior of AI agents.
Yaml Example:
```yaml
name: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
model:
  id: gpt-35-turbo
  connection:
    provider: azure
    type: chat
    endpoint: https://{your-custom-endpoint}.openai.azure.com/
```

A shorthand representation of the model configuration can also be constructed as
follows:
```yaml
name: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
model: gpt-35-turbo
```
This will be expanded as follows:
```yaml
name: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
model:
  id: gpt-35-turbo
```


## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| id |  string | The unique identifier of the model |
| connection |  [Connection](#connection) | The connection configuration for the model |


# Connection

Connection configuration for AI agents.
`provider`, `type`, and `endpoint` are required properties here,
but this section can accept additional via options.


## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| provider |  string | The unique provider of the connection |
| type |  string | The type of connection used to tell the runtime how to load and execute the agent |
| endpoint |  string | The endpoint URL for the connection |
| options |  [Options](#options) | Additional options for model execution |


# Options

Generic options available for certain models, configurations, or tools.
This can include additional settings or parameters that are not strictly defined
and are used by various providers to specify custom behavior or metadata.

Example:
```yaml
options:
  customSetting: true
  timeout: 5000
  retryAttempts: 3
 ```


