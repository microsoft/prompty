"""Tests for the connection registry (core/connections.py)."""

from __future__ import annotations

import threading
from unittest.mock import MagicMock

import pytest

from prompty.core.connections import clear_connections, get_connection, register_connection


class TestRegisterConnection:
    """Tests for register_connection()."""

    def setup_method(self):
        clear_connections()

    def teardown_method(self):
        clear_connections()

    def test_register_and_get(self):
        client = MagicMock()
        register_connection("test-conn", client=client)
        assert get_connection("test-conn") is client

    def test_register_overwrites(self):
        client1 = MagicMock()
        client2 = MagicMock()
        register_connection("test-conn", client=client1)
        register_connection("test-conn", client=client2)
        assert get_connection("test-conn") is client2

    def test_register_empty_name_raises(self):
        with pytest.raises(ValueError, match="must not be empty"):
            register_connection("", client=MagicMock())

    def test_register_none_client_raises(self):
        with pytest.raises(ValueError, match="must not be None"):
            register_connection("test-conn", client=None)

    def test_multiple_connections(self):
        c1, c2, c3 = MagicMock(), MagicMock(), MagicMock()
        register_connection("conn-a", client=c1)
        register_connection("conn-b", client=c2)
        register_connection("conn-c", client=c3)
        assert get_connection("conn-a") is c1
        assert get_connection("conn-b") is c2
        assert get_connection("conn-c") is c3


class TestGetConnection:
    """Tests for get_connection()."""

    def setup_method(self):
        clear_connections()

    def teardown_method(self):
        clear_connections()

    def test_missing_name_raises(self):
        with pytest.raises(ValueError, match="No connection registered"):
            get_connection("nonexistent")

    def test_error_message_lists_registered(self):
        register_connection("alpha", client=MagicMock())
        register_connection("beta", client=MagicMock())
        with pytest.raises(ValueError, match="alpha, beta"):
            get_connection("gamma")

    def test_error_message_none_registered(self):
        with pytest.raises(ValueError, match="\\(none\\)"):
            get_connection("anything")


class TestClearConnections:
    """Tests for clear_connections()."""

    def teardown_method(self):
        clear_connections()

    def test_clear_removes_all(self):
        register_connection("a", client=MagicMock())
        register_connection("b", client=MagicMock())
        clear_connections()
        with pytest.raises(ValueError):
            get_connection("a")

    def test_clear_idempotent(self):
        clear_connections()
        clear_connections()  # should not raise


class TestThreadSafety:
    """Verify registry is safe for concurrent access."""

    def setup_method(self):
        clear_connections()

    def teardown_method(self):
        clear_connections()

    def test_concurrent_register_and_get(self):
        errors: list[Exception] = []

        def register_many(prefix: str, count: int):
            try:
                for i in range(count):
                    register_connection(f"{prefix}-{i}", client=MagicMock())
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=register_many, args=(f"t{t}", 50)) for t in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors
        # All 200 connections should be registered
        for t in range(4):
            for i in range(50):
                assert get_connection(f"t{t}-{i}") is not None


class TestPublicAPIImport:
    """Verify registry is accessible from the public API."""

    def test_import_from_prompty(self):
        from prompty import clear_connections, get_connection, register_connection

        assert callable(register_connection)
        assert callable(get_connection)
        assert callable(clear_connections)

    def test_import_from_invoker_shim(self):
        from prompty.invoker import clear_connections, get_connection, register_connection

        assert callable(register_connection)
        assert callable(get_connection)
        assert callable(clear_connections)
