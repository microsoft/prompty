"""Tests for endpoint trust (spec §2.5.1)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from prompty import load
from prompty.core.endpoint_trust import is_trusted_endpoint
from prompty.core.errors import PromptyLoadError


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PROMPTY_TRUSTED_ENDPOINTS", raising=False)


def _write(tmp_path: Path, connection: str) -> Path:
    p = tmp_path / "t.prompty"
    p.write_text(f"---\nname: t\nmodel:\n  id: gpt-4\n  connection:\n{connection}\n---\nHello\n", encoding="utf-8")
    return p


class TestIsTrustedEndpoint:
    @pytest.mark.parametrize(
        "url",
        [
            "https://api.openai.com/v1",
            "https://API.OpenAI.com:443",
            "https://myres.openai.azure.com/",
            "https://a.b.services.ai.azure.com/api/projects/p",
            "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
        ],
    )
    def test_builtin_trusted(self, url: str):
        assert is_trusted_endpoint(url)

    @pytest.mark.parametrize(
        "url",
        [
            "http://api.openai.com",  # scheme mismatch
            "https://api.openai.com:8443",  # port mismatch
            "https://openai.azure.com",  # wildcard never matches apex
            "https://api.openai.com.evil.com",
            "https://evilopenai.azure.com",
            "https://api.openai.com@evil.com",  # userinfo ignored; host is evil.com
            "https://evil.com\\@api.openai.com",  # backslash: clients connect to evil.com
            "http://localhost:11434",
            "not a url",
            "ftp://api.openai.com",
            "",
        ],
    )
    def test_untrusted(self, url: str):
        assert not is_trusted_endpoint(url)

    def test_host_option_and_wildcard(self):
        assert is_trusted_endpoint("http://localhost:11434/v1", ["http://LOCALHOST:11434"])
        assert is_trusted_endpoint("https://x.contoso.com", ["https://*.contoso.com"])
        assert not is_trusted_endpoint("https://contoso.com", ["https://*.contoso.com"])

    def test_env_list_and_star(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("PROMPTY_TRUSTED_ENDPOINTS", " https://a.example.com , http://localhost:8080")
        assert is_trusted_endpoint("http://localhost:8080/x")
        assert not is_trusted_endpoint("http://localhost:8081")
        monkeypatch.setenv("PROMPTY_TRUSTED_ENDPOINTS", "*")
        assert is_trusted_endpoint("http://anything.example")


class TestLoaderEnforcement:
    def test_ambient_literal_endpoint_rejected(self, tmp_path: Path):
        p = _write(tmp_path, "    kind: foundry\n    endpoint: http://127.0.0.1:9999")
        with pytest.raises(PromptyLoadError) as exc:
            load(p)
        assert exc.value.kind == "untrusted_endpoint"
        assert "127.0.0.1" in str(exc.value)

    def test_env_key_literal_endpoint_rejected(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("SOME_KEY", "secret")
        p = _write(tmp_path, "    kind: key\n    endpoint: https://evil.example.com\n    apiKey: ${env:SOME_KEY}")
        with pytest.raises(PromptyLoadError, match="not trusted"):
            load(p)

    def test_oauth_token_url_checked(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("SECRET", "s")
        conn = (
            "    kind: oauth\n    endpoint: https://myres.openai.azure.com\n    clientId: c\n"
            "    clientSecret: ${env:SECRET}\n    tokenUrl: https://evil.example.com/token"
        )
        with pytest.raises(PromptyLoadError, match="tokenUrl"):
            load(_write(tmp_path, conn))

    def test_mismatched_credential_field_rejected(self, tmp_path: Path):
        p = _write(tmp_path, "    kind: foundry\n    endpoint: https://evil.example.com\n    apiKey: junk")
        with pytest.raises(PromptyLoadError, match="not trusted"):
            load(p)
        p = _write(tmp_path, "    kind: key\n    endpoint: https://evil.example.com\n    clientSecret: junk")
        with pytest.raises(PromptyLoadError, match="not trusted"):
            load(p)

    def test_literal_key_allowed(self, tmp_path: Path):
        agent = load(_write(tmp_path, "    kind: key\n    endpoint: http://127.0.0.1:9999\n    apiKey: mine"))
        assert agent.model.connection.endpoint == "http://127.0.0.1:9999"

    def test_env_endpoint_allowed(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("EP", "http://127.0.0.1:9999")
        agent = load(_write(tmp_path, "    kind: foundry\n    endpoint: ${env:EP}"))
        assert agent.model.connection.endpoint == "http://127.0.0.1:9999"

    def test_env_default_used_rejected(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.delenv("UNSET_EP", raising=False)
        with pytest.raises(PromptyLoadError, match="not trusted"):
            load(_write(tmp_path, "    kind: foundry\n    endpoint: ${env:UNSET_EP:http://127.0.0.1:9999}"))

    def test_trusted_option_allows(self, tmp_path: Path):
        p = _write(tmp_path, "    kind: foundry\n    endpoint: http://127.0.0.1:9999/api")
        agent = load(p, trusted_endpoints=["http://127.0.0.1:9999"])
        assert agent.model.connection.endpoint == "http://127.0.0.1:9999/api"

    @pytest.mark.asyncio
    async def test_async_honors_option(self, tmp_path: Path):
        from prompty import load_async

        p = _write(tmp_path, "    kind: foundry\n    endpoint: http://127.0.0.1:9999")
        with pytest.raises(PromptyLoadError):
            await load_async(p)
        agent = await load_async(p, trusted_endpoints=["http://127.0.0.1:9999"])
        assert agent.model.connection.endpoint == "http://127.0.0.1:9999"

    def test_file_model_reference_checked(self, tmp_path: Path):
        (tmp_path / "model.json").write_text(
            json.dumps({"id": "gpt-4", "connection": {"kind": "foundry", "endpoint": "https://evil.example.com"}}),
            encoding="utf-8",
        )
        p = tmp_path / "t.prompty"
        p.write_text("---\nname: t\nmodel: ${file:model.json}\n---\nHi\n", encoding="utf-8")
        with pytest.raises(PromptyLoadError, match="not trusted"):
            load(p)

    def test_frontmatter_cannot_self_trust(self, tmp_path: Path):
        p = tmp_path / "t.prompty"
        p.write_text(
            "---\nname: t\nmetadata:\n  trustedEndpoints: ['*']\n  PROMPTY_TRUSTED_ENDPOINTS: '*'\n"
            "model:\n  id: gpt-4\n  connection:\n    kind: foundry\n    endpoint: https://evil.example.com\n---\nHi\n",
            encoding="utf-8",
        )
        with pytest.raises(PromptyLoadError):
            load(p)
