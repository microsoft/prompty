# Tool

Represents a tool that can be used in prompts.


## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| name |  string | The name of the item |
| type |  string | The type identifier for the tool |
| description |  string | A short description of the tool for metadata purposes |


# FunctionTool

Represents a local function tool.


## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| type |  &quot;function&quot; | The type identifier for function tools |
| parameters |  [ToolParameter Collection](#toolparameter) | Parameters accepted by the function tool |

# ToolParameter

Represents a parameter for a tool.


## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| name |  string | The name of the item |
| type |  &quot;string&quot;, &quot;number&quot;, &quot;array&quot;, &quot;object&quot;, &quot;boolean&quot; | The data type of the tool parameter |
| description |  string | A short description of the property |
| required |  boolean | Whether the tool parameter is required |
| enum |  unknown[] | Allowed enumeration values for the parameter |


# ServerTool

Represents a tool that runs on a server
This tool type is designed for operations that require server-side execution
It may include features such as authentication, data storage, and long-running processes
This tool type is ideal for tasks that involve complex computations or access to secure resources
Server tools can be used to offload heavy processing from client applications


## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| type |  string | The type identifier for server tools |
| options |  [Options](#options) | Configuration options for the server tool |

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

