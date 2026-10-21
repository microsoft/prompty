"""Endpoint trust — keep ambient credentials on host-approved destinations (spec §2.5.1).

A ``.prompty`` file is untrusted input. When its connection carries no
file-supplied credential, executors fall back to ambient credentials
(``DefaultAzureCredential``, ``*_API_KEY`` env vars). This module decides
whether the file-chosen destination may receive them.
"""

from __future__ import annotations

import os
from collections.abc import Iterable, Mapping
from typing import Any
from urllib.parse import urlsplit

from .errors import PromptyLoadError

__all__ = ["BUILTIN_TRUSTED_ENDPOINTS", "TRUSTED_ENDPOINTS_ENV", "check_connection_trust", "is_trusted_endpoint"]

TRUSTED_ENDPOINTS_ENV = "PROMPTY_TRUSTED_ENDPOINTS"

BUILTIN_TRUSTED_ENDPOINTS: tuple[str, ...] = (
    "https://api.openai.com",
    "https://api.anthropic.com",
    "https://*.openai.azure.com",
    "https://*.services.ai.azure.com",
    "https://*.cognitiveservices.azure.com",
    "https://login.microsoftonline.com",
)

_DEFAULT_PORTS = {"http": 80, "https": 443}
_CREDENTIAL_KEYS: dict[str, str] = {"key": "apiKey"}
_DESTINATION_KEYS = ("endpoint", "tokenUrl")


def _origin(url: str) -> tuple[str, str, int] | None:
    """Return ``(scheme, host, port)`` for an absolute http(s) URL, else ``None``."""
    # HTTP clients treat '\' as '/', so parsers disagree on the host; reject outright.
    if "\\" in url:
        return None
    try:
        parts = urlsplit(url.strip())
        port = parts.port
    except ValueError:
        return None
    scheme = parts.scheme.lower()
    host = (parts.hostname or "").lower()
    if scheme not in _DEFAULT_PORTS or not host:
        return None
    return scheme, host, port if port is not None else _DEFAULT_PORTS[scheme]


def _trusted_entries(trusted_endpoints: Iterable[str] | None) -> list[str]:
    entries = [*BUILTIN_TRUSTED_ENDPOINTS, *(trusted_endpoints or ())]
    entries.extend(os.environ.get(TRUSTED_ENDPOINTS_ENV, "").split(","))
    return [e.strip() for e in entries if isinstance(e, str) and e.strip()]


def is_trusted_endpoint(url: str, trusted_endpoints: Iterable[str] | None = None) -> bool:
    """Return ``True`` if ``url``'s origin matches a built-in, host, or env trusted origin."""
    entries = _trusted_entries(trusted_endpoints)
    if "*" in entries:
        return True
    target = _origin(url)
    if target is None:
        return False
    scheme, host, port = target
    for entry in entries:
        allowed = _origin(entry)
        if allowed is None or allowed[0] != scheme or allowed[2] != port:
            continue
        pattern = allowed[1]
        if pattern.startswith("*."):
            if host.endswith(pattern[1:]):
                return True
        elif pattern == host:
            return True
    return False


def _is_reference(value: str) -> bool:
    return value.startswith("${") and value.endswith("}")


def _file_supplied_credential(connection: Mapping[str, Any]) -> bool:
    # Only the credential field the declared kind actually consumes counts; any other kind is ambient.
    kind = connection.get("kind")
    key = _CREDENTIAL_KEYS.get(kind) if isinstance(kind, str) else None
    if key is None:
        return False
    value = connection.get(key)
    # Blank keys count as absent: executors that trim fall back to ambient credentials.
    return isinstance(value, str) and bool(value.strip()) and not _is_reference(value)


def _file_controlled_destination(value: Any) -> str | None:
    """Return the effective destination if the file chose it, else ``None``."""
    if value is None:
        return None
    if not isinstance(value, str):
        return str(value)
    if _is_reference(value):
        protocol, _, rest = value[2:-1].partition(":")
        if protocol.lower() == "env":
            var_name, _, default = rest.partition(":")
            if os.environ.get(var_name) is not None:
                return None
            return default or None
    return value


def check_connection_trust(connection: Any, trusted_endpoints: Iterable[str] | None = None) -> None:
    """Raise ``untrusted_endpoint`` if ambient credentials could reach a file-chosen, untrusted destination.

    ``connection`` is the RAW (unresolved) ``model.connection`` mapping.
    """
    if not isinstance(connection, Mapping) or connection.get("kind") == "reference":
        return
    if _file_supplied_credential(connection):
        return
    for key in _DESTINATION_KEYS:
        destination = _file_controlled_destination(connection.get(key))
        if destination is not None and not is_trusted_endpoint(destination, trusted_endpoints):
            raise PromptyLoadError(
                "untrusted_endpoint",
                f"Connection {key} '{destination}' is not trusted to receive ambient credentials. "
                f"Set the {key} via ${{env:VAR}}, add its origin to trusted_endpoints or "
                f"{TRUSTED_ENDPOINTS_ENV}, or use 'kind: reference'.",
            )
