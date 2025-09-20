from prompty.core import Binding


def test_binding():
    b = Binding.load({"name": "test", "input": "input1"})
    assert b.name == "test"
    assert b.input == "input1"
