import pytest
import yaml

from prompty.common import convert_function_tools
from prompty.core import Prompty

function1 = [
    {
        "type": "function",
        "function": {
            "name": "get_current_time",
            "description": "Get the current time in a given location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "The city name, e.g. San Francisco",
                    },
                },
                "required": ["location"],
            },
        },
    }
]

yaml1 = """
tools:
  - id: get_current_time
    type: function
    description: Get the current time in a given location
    parameters:
      location:
        type: string
        description: The city name, e.g. San Francisco
        required: true
"""

function2 = [
    {
        "type": "function",
        "function": {
            "name": "get_current_weather",
            "description": "Get the current weather in a given location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string", "description": "The city and state, e.g. San Francisco, CA"},
                    "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]},
                },
                "required": ["location"],
            },
        },
    }
]

yaml2 = """
tools:
  - id: get_current_weather
    type: function
    description: Get the current weather in a given location
    parameters:
      location:
        type: string
        description: The city and state, e.g. San Francisco, CA
        required: true
      unit:
        type: string
        enum: 
            - celsius
            - fahrenheit
"""

# combine tools
function3 = [
    {
        "type": "function",
        "function": {
            "name": "get_current_time",
            "description": "Get the current time in a given location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "The city name, e.g. San Francisco",
                    },
                },
                "required": ["location"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_weather",
            "description": "Get the current weather in a given location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string", "description": "The city and state, e.g. San Francisco, CA"},
                    "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]},
                },
                "required": ["location"],
            },
        },
    },
]

yaml3 = """
tools:
  - id: get_current_time
    type: function
    description: Get the current time in a given location
    parameters:
      location:
        type: string
        description: The city name, e.g. San Francisco
        required: true
  - id: get_current_weather
    type: function
    description: Get the current weather in a given location
    parameters:
      location:
        type: string
        description: The city and state, e.g. San Francisco, CA
        required: true
      unit:
        type: string
        enum: 
            - celsius
            - fahrenheit
"""


@pytest.mark.parametrize(
    "definition,expected",
    [
        pytest.param(yaml1, function1, id="simple"),
        pytest.param(yaml2, function2, id="enum"),
        pytest.param(yaml3, function3, id="list"),
    ],
)
def test_tool_from_yaml(definition, expected):
    # test conversion from yaml to function
    fmt = yaml.load(definition, Loader=yaml.FullLoader)
    tools = Prompty.load_tools(fmt["tools"])
    obj = convert_function_tools(tools)
    assert obj == expected
