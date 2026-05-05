"""Integration tests — Entra ID (Azure AD) authentication against Azure OpenAI via Foundry provider.

Uses ``AzureOpenAI`` with ``DefaultAzureCredential`` (no API key).
Requires ``AZURE_OPENAI_ENDPOINT`` and ``AZURE_OPENAI_CHAT_DEPLOYMENT`` env vars.
Skips gracefully when Azure credentials are not available (run ``az login`` first).
"""

from __future__ import annotations

import pytest

from prompty.core.types import Message, TextPart
from prompty.providers.foundry.executor import FoundryExecutor
from prompty.providers.foundry.processor import FoundryProcessor

from .conftest import make_entra_agent, skip_entra


def _hello_messages() -> list[Message]:
    return [
        Message(
            role="system",
            parts=[TextPart(value="You are a helpful assistant. Reply in one short sentence.")],
        ),
        Message(role="user", parts=[TextPart(value="Say hello.")]),
    ]


# ---------------------------------------------------------------------------
# Entra ID (DefaultAzureCredential) — no API key
# ---------------------------------------------------------------------------


@skip_entra
class TestEntraId:
    executor = FoundryExecutor()
    processor = FoundryProcessor()

    def test_entra_id_token_acquisition(self):
        """Verify DefaultAzureCredential can acquire a token for Cognitive Services."""
        try:
            from azure.identity import DefaultAzureCredential
        except ImportError:
            pytest.skip("azure-identity not installed")

        credential = DefaultAzureCredential()
        try:
            token = credential.get_token("https://cognitiveservices.azure.com/.default")
        except Exception as exc:
            pytest.skip(f"DefaultAzureCredential failed — run `az login` first. ({exc})")

        assert token.token, "Token should not be empty"
        assert token.expires_on > 0, "Token should have a valid expiration"

    def test_entra_id_chat_completion(self):
        """Chat completion using Entra ID auth (FoundryConnection, no apiKey)."""
        agent = make_entra_agent(options={"maxOutputTokens": 50, "temperature": 0})
        messages = _hello_messages()

        try:
            response = self.executor.execute(agent, messages)
        except ImportError:
            pytest.skip("azure-identity not installed")
        except Exception as exc:
            _skip_on_auth_error(exc)
            raise

        result = self.processor.process(agent, response)
        assert isinstance(result, str)
        assert len(result) > 0

    @pytest.mark.asyncio
    async def test_entra_id_chat_completion_async(self):
        """Async chat completion using Entra ID auth."""
        agent = make_entra_agent(options={"maxOutputTokens": 50, "temperature": 0})
        messages = _hello_messages()

        try:
            response = await self.executor.execute_async(agent, messages)
        except ImportError:
            pytest.skip("azure-identity not installed")
        except Exception as exc:
            _skip_on_auth_error(exc)
            raise

        result = await self.processor.process_async(agent, response)
        assert isinstance(result, str)
        assert len(result) > 0


def _skip_on_auth_error(exc: Exception) -> None:
    """Skip the test with a helpful message if the error is auth-related."""
    exc_type = type(exc).__name__
    exc_text = str(exc).lower()

    # azure.identity.CredentialUnavailableError or AuthenticationError
    if "Credential" in exc_type or "Authentication" in exc_type:
        pytest.skip(f"Azure Entra ID credentials not available — run `az login` first. ({exc})")

    # openai.AuthenticationError (HTTP 401/403)
    if "AuthenticationError" in exc_type or "PermissionDenied" in exc_type:
        pytest.skip(
            f"Azure Entra ID authorization failed — ensure your identity has "
            f"'Cognitive Services OpenAI User' role on the resource. ({exc})"
        )

    # HTTP status code check for generic API errors
    status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
    if status in (401, 403):
        pytest.skip(
            f"Azure Entra ID authorization failed (HTTP {status}) — ensure your identity has "
            f"'Cognitive Services OpenAI User' role on the resource. ({exc})"
        )

    if status == 400 and "tenant" in exc_text and "does not match" in exc_text:
        pytest.skip("Azure Entra ID tenant mismatch — log in with an identity from the Azure OpenAI resource tenant.")
