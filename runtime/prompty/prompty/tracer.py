import abc
import json
import inspect
import datetime
from numbers import Number
import os
from datetime import datetime
from pathlib import Path
from pydantic import BaseModel
from functools import wraps, partial
from typing import Any, Callable, Dict, List


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
    def add_tracer(cls, name: str, tracer: Tracer) -> None:
        cls._tracers[name] = tracer

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
    def to_dict(cls, obj: Any) -> Dict[str, Any]:
        # simple json types
        if isinstance(obj, str) or isinstance(obj, Number) or isinstance(obj, bool):
            return obj
        # datetime
        elif isinstance(obj, datetime):
            return obj.isoformat()
        # safe Prompty obj serialization
        elif type(obj).__name__ == "Prompty":
            return obj.to_safe_dict()
        # pydantic models have their own json serialization
        elif isinstance(obj, BaseModel):
            return obj.model_dump()
        # recursive list and dict
        elif isinstance(obj, list):
            return [Trace.to_dict(item) for item in obj]
        elif isinstance(obj, dict):
            return {
                k: v if isinstance(v, str) else Trace.to_dict(v)
                for k, v in obj.items()
            }
        elif isinstance(obj, Path):
            return str(obj)
        # cast to string otherwise...
        else:
            return str(obj)


def _name(func: Callable, args):
    if hasattr(func, "__qualname__"):
        signature = f"{func.__module__}.{func.__qualname__}"
    else:
        signature = f"{func.__module__}.{func.__name__}"

    # core invoker gets special treatment
    core_invoker = signature == "prompty.core.Invoker.__call__"
    if core_invoker:
        name = type(args[0]).__name__
        signature = f"{args[0].__module__}.{args[0].__class__.__name__}.invoke"
    else:
        name = func.__name__

    return name, signature


def _inputs(func: Callable, args, kwargs) -> dict:
    ba = inspect.signature(func).bind(*args, **kwargs)
    ba.apply_defaults()

    inputs = {k: Trace.to_dict(v) for k, v in ba.arguments.items() if k != "self"}

    return inputs

def _results(result: Any) -> dict:
    return {
        "result": Trace.to_dict(result) if result is not None else "None",
    }

def _trace_sync(func: Callable = None, *, description: str = None) -> Callable:
    description = description or ""

    @wraps(func)
    def wrapper(*args, **kwargs):
        name, signature = _name(func, args)
        Trace.start(name)
        Trace.add("signature", signature)
        if description and description != "":
            Trace.add("description", description)

        inputs = _inputs(func, args, kwargs)
        Trace.add("inputs", inputs)

        result = func(*args, **kwargs)
        Trace.add("result", _results(result))

        Trace.end()

        return result
    
    return wrapper

def _trace_async(func: Callable = None, *, description: str = None) -> Callable:
    description = description or ""

    @wraps(func)
    async def wrapper(*args, **kwargs):
        name, signature = _name(func, args)
        Trace.start(name)
        Trace.add("signature", signature)
        if description and description != "":
            Trace.add("description", description)

        inputs = _inputs(func, args, kwargs)
        Trace.add("inputs", inputs)

        result = await func(*args, **kwargs)
        Trace.add("result", _results(result))

        Trace.end()

        return result
    
    return wrapper

def trace(func: Callable = None, *, description: str = None) -> Callable:
    if func is None:
        return partial(trace, description=description)
    
    wrapped_method = (
        _trace_async if inspect.iscoroutinefunction(func) else _trace_sync
    )

    return wrapped_method(func, description=description)


class PromptyTracer(Tracer):
    _stack: List[Dict[str, Any]] = []
    _name: str = None

    def __init__(self, output_dir: str = None) -> None:
        super().__init__()
        if output_dir:
            self.root = Path(output_dir).resolve().absolute()
        else:
            self.root = Path(Path(os.getcwd()) / ".runs").resolve().absolute()

        if not self.root.exists():
            self.root.mkdir(parents=True, exist_ok=True)

    def start(self, name: str) -> None:
        self._stack.append({"name": name})
        # first entry frame
        if self._name is None:
            self._name = name

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
        
        trace_file = (
            self.root / f"{self._name}.{datetime.now().strftime('%Y%m%d.%H%M%S')}.ptrace"
        )
        
        with open(trace_file, "w") as f:
            json.dump(frame, f, indent=4)
