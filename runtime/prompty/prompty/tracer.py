import abc
import json
import inspect
import datetime
from pathlib import Path
from numbers import Number
from pydantic import BaseModel
from functools import wraps, partial
from typing import Any, Callable, Dict


class Tracer(abc.ABC):

    @abc.abstractmethod
    def start(self, name: str) -> None:
        pass

    @abc.abstractmethod
    def trace(self, key: str, value: Any) -> None:
        pass

    @abc.abstractmethod
    def end(self) -> None:
        pass


class Trace:
    _tracers: Dict[str, Tracer] = {}

    @classmethod
    def register(cls, name: str, tracer: Tracer) -> None:
        cls._tracers[name] = tracer()

    @classmethod
    def start(cls, name: str) -> None:
        for tracer in cls._tracers.values():
            tracer.start(name)

    @classmethod
    def trace(cls, name: str, value: Any) -> None:
        for tracer in cls._tracers.values():
            tracer.trace(name, value)

    @classmethod
    def end(cls, name: str) -> None:
        for tracer in cls._tracers.values():
            tracer.end(name)

    @classmethod
    def clear(cls) -> None:
        cls._tracers = {}

    @classmethod
    def register(cls, name: str):
        def inner_wrapper(wrapped_class: Tracer) -> Callable:
            cls._tracers[name] = wrapped_class()
            return wrapped_class
        return inner_wrapper

    @classmethod
    def json_dump(cls, obj: Any) -> str:

        """
        Recursively converts a Python object to a JSON string.

        Args:
            obj: The Python object to be converted.

        Returns:
            A JSON string representation of the object.
        """

        if isinstance(obj, str):
            return obj
        elif type(obj).__name__ == "Prompty":
            return obj.to_safe_json()
        elif isinstance(obj, Path):
            return str(obj)
        elif isinstance(obj, BaseModel):
            return obj.model_dump_json()
        elif isinstance(obj, list):
            return [Trace.json_dump(item) for item in obj]
        elif isinstance(obj, dict):
            return json.dumps(
                {
                    k: v if isinstance(v, str) else Trace.json_dump(v)
                    for k, v in obj.items()
                }
            )
        elif isinstance(obj, Number):
            return obj
        elif isinstance(obj, bool):
            return obj
        else:
            return str(obj)


def trace(func: Callable = None, *, description: str = None) -> Callable:
    """
    Decorator function that traces the execution of a given function.

    Args:
        func (Callable): The function to be traced.
        name (str, optional): The name of the output to be logged. Defaults to None.

    Returns:
        Callable: The wrapped function with tracing capabilities.
    """

    if func is None:
        return partial(trace, description=description)

    description = description or ""

    @wraps(func)
    def wrapper(*args, **kwargs):
        if hasattr(func, "__qualname__"):
            signature = f"{func.__module__}.{func.__qualname__}"
        else:
            signature = f"{func.__module__}.{func.__name__}"

        # core invoker gets special treatment
        core_invoker = signature == "prompty.core.Invoker.__call__"
        if core_invoker:
            span_name = type(args[0]).__name__
        else:
            span_name = func.__name__

        Trace.start(span_name)

        if core_invoker:
            Trace.trace(
                "signature",
                f"{args[0].__module__}.{args[0].__class__.__name__}.invoke",
            )
        else:
            Trace.trace("signature", signature)

        if len(description) > 0:
            Trace.trace("description", description)

        ba = inspect.signature(func).bind(*args, **kwargs)
        ba.apply_defaults()
        if core_invoker:
            obj = args[1].model_dump()
            keys = list(obj.keys())
            if len(keys) == 1:
                inputs = obj[keys[0]]
            else:
                inputs = obj
        else:
            inputs = {
                k: Trace.json_dump(v) for k, v in ba.arguments.items() if k != "self"
            }

        input = Trace.json_dump(inputs)
        Trace.trace("input", input)
        result = func(*args, **kwargs)
        Trace.trace(
            "result",
            Trace.json_dump(result) if result is not None else "None",
        )

        Trace.end(span_name)

        return result

    return wrapper

@Trace.register("prompty")
class PromptyTracer(Tracer):
    def start(self, name: str) -> None:
        print(f"Starting {name}")

    def trace(self, name: str, value: Any) -> None:
        print(f"Tracing {name}: {value}")

    def end(self, name: str) -> None:
        print(f"Ending {name}")
