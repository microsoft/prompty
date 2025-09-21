from prompty.core import GenericConnection


def test_create_genericconnection():
    instance = GenericConnection()
    assert instance is not None
