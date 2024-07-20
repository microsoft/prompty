import abc
import json
import inspect
import datetime
from numbers import Number
from pydantic import BaseModel
from functools import wraps, partial
from typing import Any, Callable, Dict, Iterator, List


class Tracer(abc.ABC):

    @abc.abstractmethod
    def start(self, name: str) -> None:
        pass

    @abc.abstractmethod
    def add(self, key: str, value: Any) -> None:
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
    def add(cls, name: str, value: Any) -> None:
        for tracer in cls._tracers.values():
            tracer.add(name, value)

    @classmethod
    def end(cls) -> None:
        for tracer in cls._tracers.values():
            tracer.end()

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
    def dict_dump(cls, obj: Any) -> Dict[str, Any]:
        # simple json types
        if isinstance(obj, str) or isinstance(obj, Number) or isinstance(obj, bool):
            return obj
        # datetime
        elif isinstance(obj, datetime.datetime):
            return obj.isoformat()
        # sanitize Prompty objects
        elif type(obj).__name__ == "Prompty":
            return obj.to_safe_dict()
        # pydantic models have their own json serialization
        elif isinstance(obj, BaseModel):
            return obj.model_dump()
        # recursive list and dict
        elif isinstance(obj, list):
            return [Trace.dict_dump(item) for item in obj]
        elif isinstance(obj, dict):
            return {
                k: v if isinstance(v, str) else Trace.dict_dump(v)
                for k, v in obj.items()
            }

        # cast to string otherwise...
        else:
            return str(obj)

    @classmethod
    def json_dump(cls, obj: Any) -> str:
        # simple json types
        if isinstance(obj, str) or isinstance(obj, Number) or isinstance(obj, bool):
            return obj
        # datetime
        elif isinstance(obj, datetime.datetime):
            return obj.isoformat()
        # sanitize Prompty objects
        elif type(obj).__name__ == "Prompty":
            return obj.to_safe_json()
        # pydantic models have their own json serialization
        elif isinstance(obj, BaseModel):
            return obj.model_dump_json()
        # recursive list and dict
        elif isinstance(obj, list):
            return [Trace.json_dump(item) for item in obj]
        elif isinstance(obj, dict):
            return json.dumps(
                {
                    k: v if isinstance(v, str) else Trace.json_dump(v)
                    for k, v in obj.items()
                }
            )
        # cast to string otherwise...
        else:
            return str(obj)


def trace(func: Callable = None, *, description: str = None) -> Callable:
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
            name = type(args[0]).__name__
        else:
            name = func.__name__

        Trace.start(name)

        if core_invoker:
            Trace.add(
                "signature",
                f"{args[0].__module__}.{args[0].__class__.__name__}.invoke",
            )
        else:
            Trace.add("signature", signature)

        if len(description) > 0:
            Trace.add("description", description)

        ba = inspect.signature(func).bind(*args, **kwargs)
        ba.apply_defaults()

        inputs = {k: Trace.dict_dump(v) for k, v in ba.arguments.items() if k != "self"}

        Trace.add("input", Trace.dict_dump(inputs))
        result = func(*args, **kwargs)

        Trace.add(
            "result",
            Trace.dict_dump(result) if result is not None else "None",
        )

        Trace.end()

        return result

    return wrapper


@Trace.register("prompty")
class PromptyTracer(Tracer):
    _stack: List[Dict[str, Any]] = []

    def start(self, name: str) -> None:
        self._stack.append({"name": name})

    def add(self, name: str, value: Any) -> None:
        frame = self._stack[-1]
        if name not in frame:
            frame[name] = value
        # multiple values creates list
        else:
            if isinstance(frame[name], list):
                frame[name].append(value)
            else:
                frame[name] = [frame[name], value]


    def end(self) -> None:
        # pop the current stack
        frame = self._stack.pop()

        # if stack is empty, dump the frame
        if len(self._stack) == 0:
            self.flush(frame)
        # otherwise, append the frame to the parent
        else:
            if "__frames" not in self._stack[-1]:
                self._stack[-1]["__frames"] = []
            self._stack[-1]["__frames"].append(frame)

    def flush(self, frame: Dict[str, Any]) -> None:
        with open("trace.json", "w") as f:
            json.dump(frame, f, indent=4)
