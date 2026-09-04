"""Cassette-capture tooling for the service-drill vector (NOT a pytest test).

Run this to (re)generate ``cassettes/openai_chat_drill.json``. It synthesizes a
schema-valid OpenAI ``ChatCompletion`` response, serves it from a local
``CassetteReplayServer``, drives the REAL executor once through the same code
path the drill adapter uses (``_drill_execute``), and freezes the captured
outbound request as the cassette's ``request`` plane. The recorded response is
the ``response`` plane.

This lives in CI/dev tooling, NEVER in the assertion path: it does not diff or
auto-rewrite during conformance. The ``request`` it records is exactly what the
drill's wire plane later asserts against, so capturing (rather than
hand-fabricating) keeps the wire contract honest and reproducible.

Usage (from ``runtime/python/prompty``):

    uv run python tests/model/record_cassette.py

The prefix is deliberately ``record_`` (not ``test_``) so pytest ignores it.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from _drill_replay import CassetteReplayServer  # noqa: E402
from vector_adapters import _DRILL_REPLAY_API_KEY, _drill_execute  # noqa: E402

# Mirror the drill vector's `input` (schema/model/conformance/vectors/drill.tsp).
# The apiKey/endpoint refs are intentionally absent here -- capture always binds
# the transport to the local replay server, never a real provider.
_DRILL_INPUT: dict = {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Say hello in exactly one word."}],
    "options": {"temperature": 0, "maxOutputTokens": 16},
}


def _synthesize_response() -> dict:
    """A schema-valid OpenAI ChatCompletion the SDK can parse into a response."""
    return {
        "id": "chatcmpl-drill-openai-0001",
        "object": "chat.completion",
        "created": 1_700_000_000,
        "model": "gpt-4o-mini",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "Hello"},
                "finish_reason": "stop",
                "logprobs": None,
            }
        ],
        "usage": {"prompt_tokens": 12, "completion_tokens": 1, "total_tokens": 13},
    }


def main() -> None:
    response_body = _synthesize_response()

    with CassetteReplayServer(response_body) as server:
        raw = _drill_execute(_DRILL_INPUT, endpoint=server.base_url, api_key=_DRILL_REPLAY_API_KEY)
        if raw is None:
            raise SystemExit("capture failed: executor returned no response")
        captured = server.last_request
        if captured is None:
            raise SystemExit("capture failed: no request reached the replay server")

    cassette = {
        "_comment": (
            "Service-drill cassette for LiveChatConformance.complete/openai_chat_drill. "
            "Consumer-owned roster: NOT modeled in TypeSpec/Typra. Regenerate with "
            "`uv run python tests/model/record_cassette.py`. `request.body` is the wire "
            "plane the drill adapter asserts; `response.body` is replayed as the seam bytes."
        ),
        "recordedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "request": {
            "method": captured.get("method"),
            "path": captured.get("path"),
            "body": captured.get("body"),
        },
        "response": {
            "status": 200,
            "body": response_body,
        },
    }

    out_dir = _HERE / "cassettes"
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / "openai_chat_drill.json"
    out_path.write_text(json.dumps(cassette, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    rel = os.path.relpath(out_path, Path.cwd())
    print(f"wrote {rel}")
    print(f"  request.body = {json.dumps(cassette['request']['body'], sort_keys=True)}")


if __name__ == "__main__":
    main()
