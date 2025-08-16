# Output

Represents the output properties of an AI agent.
Each output property can be a simple type, an array, or an object.


## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| name |  string | The name of the item |
| type |  &quot;string&quot;, &quot;number&quot;, &quot;array&quot;, &quot;object&quot;, &quot;boolean&quot; | The data type of the output property |
| description |  string | A short description of the output property |
| required |  boolean | Whether the output property is required |


# ArrayOutput

Represents an array output property.
This extends the base Output model to represent an array of items.


## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| type |  &quot;array&quot; |  |
| items |  [Output](#output) | The type of items contained in the array |


# ObjectOutput

Represents an object output property.
This extends the base Output model to represent a structured object.


## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| type |  &quot;object&quot; |  |
| properties |  [Output Collection](#output) | The properties contained in the object |

