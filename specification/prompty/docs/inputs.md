# Input

Represents a single input property for a prompt.
* This model defines the structure of input properties that can be used in prompts,
including their type, description, whether they are required, and other attributes.
* It allows for the definition of dynamic inputs that can be filled with data
and processed to generate prompts for AI models.
* Example:
```yaml
inputs:
  property1: string
  property2: number
  property3: boolean
```


## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| name |  string | The name of the item |
| type |  &quot;string&quot;, &quot;number&quot;, &quot;array&quot;, &quot;object&quot;, &quot;boolean&quot; | The data type of the input property |
| description |  string | A short description of the input property |
| required |  boolean | Whether the input property is required |
| strict |  boolean | Whether the input property can emit structural text when parsing output |
| default |  unknown | The default value of the input |
| sample |  unknown | A sample value of the input for examples and tooling |
| binding |  [Binding](#binding) | Tool binding information if using property for tool calling |

# Binding

This allows for inputs to be bound to tool parameters.
It is used to specify which input property corresponds to which tool parameter
So it can participate in the tool&#39;s execution context as passed in parameters.


## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| tool |  string | The name of the tool to bind the input to |
| argument |  string | The name of the argument in the tool&#39;s parameter list |

