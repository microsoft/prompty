import typing

from .core import ToolProperty


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
