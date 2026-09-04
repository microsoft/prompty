"""Local cassette-replay HTTP transport for the service-drill vector.

The drill binds the Executor->Processor transport seam via **base-URL redirect**:
the provider SDK is pointed at a local ``http.server`` thread that serves a
recorded response and records the inbound request. This is the consumer-owned
"roster" half of the drill -- deliberately NOT modeled in TypeSpec/Typra, since
cassette bytes and provider-SDK transport binding stay runtime-owned.

Two use sites share one server:

* **capture** (tooling, `record_cassette.py`): serve a synthesized provider
  response, drive the real executor once, and freeze the captured request as the
  cassette's ``request`` plane.
* **replay** (`vector_adapters.py` drill adapter): serve the cassette's recorded
  response and assert the freshly captured request matches the cassette
  (``wire`` plane).

No production code changes: the executor's own connection ``endpoint`` is set to
``server.base_url`` and its OpenAI SDK POSTs there exactly as it would to the
real base URL.
"""

from __future__ import annotations

import http.server
import json
import threading
from typing import Any


class _RecordingHandler(http.server.BaseHTTPRequestHandler):
    """Records each POST body and replies with the server's canned response."""

    # Silence the default stderr access log so conformance output stays clean.
    def log_message(self, *args: Any) -> None:  # noqa: D401 - stdlib override
        return

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler name
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b""
        try:
            body: Any = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            body = {"__raw__": raw.decode("utf-8", "replace")}
        server: Any = self.server
        server.captured.append({"method": "POST", "path": self.path, "body": body})

        payload = json.dumps(server.response_body).encode("utf-8")
        self.send_response(server.response_status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class CassetteReplayServer:
    """A background HTTP server that replays one response and records requests.

    Use as a context manager. ``base_url`` is the redirect target to hand the
    provider SDK; ``last_request`` is the most recently captured outbound request
    (the wire plane's observed value).
    """

    def __init__(self, response_body: Any, response_status: int = 200) -> None:
        self._response_body = response_body
        self._response_status = response_status
        self._httpd: http.server.HTTPServer | None = None
        self._thread: threading.Thread | None = None
        self.captured: list[dict[str, Any]] = []

    def __enter__(self) -> CassetteReplayServer:
        httpd = http.server.HTTPServer(("127.0.0.1", 0), _RecordingHandler)
        # Stash server-scoped state the handler reads off ``self.server``.
        httpd.captured = self.captured  # type: ignore[attr-defined]
        httpd.response_body = self._response_body  # type: ignore[attr-defined]
        httpd.response_status = self._response_status  # type: ignore[attr-defined]
        self._httpd = httpd
        self._thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
        if self._thread is not None:
            self._thread.join(timeout=2)

    @property
    def base_url(self) -> str:
        assert self._httpd is not None, "server not started"
        host, port = self._httpd.server_address[:2]
        return f"http://{host}:{port}"

    @property
    def last_request(self) -> dict[str, Any] | None:
        return self.captured[-1] if self.captured else None
