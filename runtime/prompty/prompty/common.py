import typing

from .core import OutputProperty, ToolProperty


def convert_function_tools(tools: list[ToolProperty]) -> list[dict[str, typing.Any]]:
    """Convert the tools to a list of dictionaries
    Parameters
    ----------
    tools : list[ToolProperty]
        The tools to convert
    Returns
    -------
    list[dict[str, typing.Any]]
        The converted tools
    """
    if tools:
        return [
            {
                "type": "function",
                "function": {
                    "name": tool.id,
                    "description": tool.description,
                    "parameters": {
                        "type": "object",
                        "properties": {
                            p.name: {
                                "type": p.type,
                                **({"description": p.description} if p.description else {}),
                                **({"enum": p.enum} if p.enum else {}),
                            }
                            for p in tool.parameters
                        },
                        "required": [p.name for p in tool.parameters if p.required],
                    },
                },
            }
            for tool in tools
            if tool.type == "function"
        ]
    return []


def convert_output_props(name: str, outputs: list[OutputProperty]) -> dict[str, typing.Any]:
    """Convert the tools to a list of dictionaries
    Parameters
    ----------
    tools : list[OutputProperty]
        The tools to convert
    Returns
    -------
    list[dict[str, typing.Any]]
        The converted tools
    """
    if outputs:
        return {
            "type": "json_schema",
            "json_schema": {
                "name": name,
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {p.name: _convert_output_object(p) for p in outputs},
                    "required": [p.name for p in outputs if p.required],
                    "additionalProperties": False,
                },
            },
        }
    return {}


def _convert_output_object(output: OutputProperty) -> dict[str, typing.Any]:
    """Convert an OutputProperty to a dictionary"""
    if output.type == "array":
        if output.items is None:
            raise ValueError("Array type must have items defined")

        o = _convert_output_object(output.items)
        if "name" in o:
            o.pop("name")

        return {
            "type": "array",
            "items": o,
        }
    elif output.type == "object":
        return {
            "type": "object",
            "properties": {prop.name: _convert_output_object(prop) for prop in output.properties},
            "required": [prop.name for prop in output.properties if prop.required],
            "additionalProperties": False,
        }
    else:
        return {
            "type": output.type,
            "description": output.description,
            **({"enum": output.enum} if output.enum else {}),
        }
