"""Thread-safe connection registry for named connections.

Connections are registered by name at application startup and looked up by
executors when the agent's model uses ``kind: reference``. This decouples
credential management from the ``.prompty`` file format.

Usage::

    from openai import AzureOpenAI
    import prompty

    client = AzureOpenAI(azure_endpoint="...", api_key="...")
    prompty.register_connection("azure-openai", client=client)

    # Later — executor resolves "azure-openai" via get_connection()
"""

from __future__ import annotations

import threading
from typing import Any

__all__ = ["register_connection", "get_connection", "clear_connections"]

_lock = threading.Lock()
_connections: dict[str, Any] = {}


def register_connection(name: str, *, client: Any) -> None:
    """Register a named connection with an SDK client instance.

    Parameters
    ----------
    name:
        The connection name referenced in ``.prompty`` files via
        ``connection.kind: reference`` and ``connection.name``.
    client:
        An SDK client instance (e.g. ``openai.AzureOpenAI``,
        ``openai.OpenAI``, ``anthropic.Anthropic``).

    Raises
    ------
    ValueError
        If *name* is empty or *client* is ``None``.
    """
    if not name:
        raise ValueError("Connection name must not be empty.")
    if client is None:
        raise ValueError("Client must not be None.")
    with _lock:
        _connections[name] = client


def get_connection(name: str) -> Any:
    """Look up a previously registered connection by name.

    Parameters
    ----------
    name:
        The connection name to look up.

    Returns
    -------
    Any
        The registered SDK client instance.

    Raises
    ------
    ValueError
        If no connection has been registered under *name*.
    """
    with _lock:
        try:
            return _connections[name]
        except KeyError:
            registered = ", ".join(sorted(_connections)) or "(none)"
            raise ValueError(
                f"No connection registered with name '{name}'. "
                f"Call prompty.register_connection('{name}', client=...) at startup. "
                f"Currently registered: {registered}"
            ) from None


def clear_connections() -> None:
    """Remove all registered connections.

    Primarily useful in tests to reset global state between test cases.
    """
    with _lock:
        _connections.clear()
