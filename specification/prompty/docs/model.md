# Model

Model for defining the structure and behavior of AI agents.


## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| id |  string | The unique identifier of the model |
| api |  string | The API used by the agent (e.g., chat, completion) |
| connection |  [Connection](#connection) | The connection configuration for the model |
| options |  [Options](#options) | Additional options for model execution |

# Connection

Model for defining the connection configuration for AI agents.
`type` is a required property here, but this section can accept additional properties as needed.


## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| type |  string | The type of connection used to tell the runtime how to load and execute the agent |


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

