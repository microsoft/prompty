import json

from prompty.core import McpTool


def test_create_mcptool():
    instance = McpTool()
    assert instance is not None


def test_load_mcptool():
    json_data = """
    {
      "kind": "mcp",
      "connection": {
        "kind": "provider-connection"
      },
      "name": "My MCP Tool",
      "url": "https://mcp.server.com",
      "allowed": [
        "operation1",
        "operation2"
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = McpTool.load(data)
    assert instance is not None
    assert instance.kind == "mcp"
    assert instance.name == "My MCP Tool"
    assert instance.url == "https://mcp.server.com"
