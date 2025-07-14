import abc
import os
import typing
from typing import Callable, Literal, Union

from .core import Prompty
from .tracer import trace


class Invoker(abc.ABC):
    """Abstract class for Invoker

    Attributes
    ----------
    prompty : Prompty
        The prompty object
    name : str
        The name of the invoker

    """

    def __init__(self, prompty: Prompty) -> None:
        self.prompty = prompty
        self.name = self.__class__.__name__
        self._resolved = False

    @abc.abstractmethod
    def invoke(self, data: typing.Any) -> typing.Any:
        """Abstract method to invoke the invoker

        Parameters
        ----------
        data : any
            The data to be invoked

        Returns
        -------
        any
            The invoked
        """
        pass

    @abc.abstractmethod
    async def invoke_async(self, data: typing.Any) -> typing.Any:
        """Abstract method to invoke the invoker asynchronously

        Parameters
        ----------
        data : any
            The data to be invoked

        Returns
        -------
        any
            The invoked
        """
        pass

    @trace
    def run(self, data: typing.Any) -> typing.Any:
        """Method to run the invoker

        Parameters
        ----------
        data : any
            The data to be invoked

        Returns
        -------
        any
            The invoked
        """

        return self.invoke(data)

    @trace
    async def run_async(self, data: typing.Any) -> typing.Any:
        """Method to run the invoker asynchronously

        Parameters
        ----------
        data : any
            The data to be invoked

        Returns
        -------
        any
            The invoked
        """
        return await self.invoke_async(data)

    @staticmethod
    def _process_env(variable: str, env_error=True, default: Union[str, None] = None) -> typing.Any:
        if variable in os.environ.keys():
            return os.environ[variable]
        else:
            if default:
                return default
            if env_error:
                raise ValueError(f"Variable {variable} not found in environment")

            return ""

    def resolve_model(self) -> None:
        """Resolve model variables"""

        # only resolve once
        if self._resolved:
            return

        self.prompty.model.connection = self.resolve_slots("manifest.model.connection", self.prompty.model.connection)

        self.prompty.model.options = self.resolve_slots("manifest.model.options", self.prompty.model.options)
        self._resolved = True

    def resolve_slots(self, root: str, attribute: typing.Any) -> typing.Any:
        if isinstance(attribute, str):
            if attribute.startswith("${env"):
                variable = attribute[2:-1].split(":")
                if len(variable) < 2:
                    raise ValueError(f"Invalid environment/slot variable {attribute}")

                key = variable[1].strip()
                idx = next(
                    (
                        index
                        for index, item in enumerate(self.prompty.slots)
                        if item["key"] == key and item["name"].endswith(root)
                    ),
                    -1,
                )

                if idx == -1:
                    raise ValueError(f"Slot {key} not found in Prompty slots for {root}")
                else:
                    # use value if it exists
                    if "value" in self.prompty.slots[idx]:
                        return self.prompty.slots[idx]["value"]
                    # otherwise, use env variable
                    else:
                        # cache the env variable in the slot
                        # if the env variable is not found, use the default value
                        self.prompty.slots[idx]["value"] = self._process_env(
                            key, env_error=True, default=self.prompty.slots[idx].get("default", None)
                        )
                        return self.prompty.slots[idx]["value"]
            else:
                return attribute

        if isinstance(attribute, list):

            def get_key(v: dict[str, str], i) -> str:
                if "name" in v:
                    return v["name"]
                elif "id" in v:
                    return v["id"]
                else:
                    return str(i)

            return [self.resolve_slots(f"{root}.{get_key(v, i)}", v) for i, v in enumerate(attribute)]

        if isinstance(attribute, dict):
            return {key: self.resolve_slots(f"{root}.{key}", value) for key, value in attribute.items()}

        return attribute


class Renderer(Invoker):
    """Abstract class for Renderer

    Attributes
    ----------
    prompty : Prompty
        The prompty object
    name : str
        The name of the renderer

    """

    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)

    @trace
    def run(self, data: typing.Any) -> typing.Any:
        """Method to run the invoker

        Parameters
        ----------
        data : any
            The data to be invoked

        Returns
        -------
        any
            The invoked
        """

        # check if parser inherits from Parser
        parser = InvokerFactory._get_invoker("parser", self.prompty)
        if isinstance(parser, Parser):
            self.prompty.template.content = parser.sanitize(self.prompty.content)

        return self.invoke(data)

    @trace
    async def run_async(self, data: typing.Any) -> typing.Any:
        """Method to run the invoker asynchronously

        Parameters
        ----------
        data : any
            The data to be invoked

        Returns
        -------
        any
            The invoked
        """

        # check if parser inherits from Parser
        parser = InvokerFactory._get_invoker("parser", self.prompty)
        if isinstance(parser, Parser):
            self.prompty.template.content = parser.sanitize(self.prompty.content)

        return await self.invoke_async(data)


class Parser(Invoker):
    """Abstract class for Parser

    Attributes
    ----------
    prompty : Prompty
        The prompty object
    name : str
        The name of the parser

    """

    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)

    @abc.abstractmethod
    def sanitize(self, data: typing.Any) -> typing.Any:
        """Abstract method to sanitize template

        Parameters
        ----------
        data : any
            The data to be invoked

        Returns
        -------
        any
            The invoked
        """
        pass

    @abc.abstractmethod
    def process(self, data: typing.Any) -> typing.Any:
        """Method to process parsed content

        Parameters
        ----------
        data : any
            The parsed content

        Returns
        -------
        any
            Processed parsed data
        """
        pass

    @trace
    def run(self, data: typing.Any) -> typing.Any:
        """Method to run the invoker

        Parameters
        ----------
        data : any
            The data to be invoked

        Returns
        -------
        any
            The invoked
        """

        parsed = self.invoke(data)
        return self.process(parsed)

    @trace
    async def run_async(self, data: typing.Any) -> typing.Any:
        """Method to run the invoker asynchronously

        Parameters
        ----------
        data : any
            The data to be invoked

        Returns
        -------
        any
            The invoked
        """
        parsed = await self.invoke_async(data)
        return self.process(parsed)


InvokerTypes = Literal["renderer", "parser", "executor", "processor"]


class InvokerFactory:
    """Factory class for Invoker"""

    _renderers: dict[str, type[Invoker]] = {}
    _parsers: dict[str, type[Invoker]] = {}
    _executors: dict[str, type[Invoker]] = {}
    _processors: dict[str, type[Invoker]] = {}

    @classmethod
    def add_renderer(cls, name: str, invoker: type[Invoker]) -> None:
        cls._renderers[name] = invoker

    @classmethod
    def add_parser(cls, name: str, invoker: type[Invoker]) -> None:
        cls._parsers[name] = invoker

    @classmethod
    def add_executor(cls, name: str, invoker: type[Invoker]) -> None:
        cls._executors[name] = invoker

    @classmethod
    def add_processor(cls, name: str, invoker: type[Invoker]) -> None:
        cls._processors[name] = invoker

    @classmethod
    def register_renderer(cls, name: str) -> Callable:

        def inner_wrapper(wrapped_class: type[Invoker]) -> type[Invoker]:
            cls._renderers[name] = wrapped_class
            return wrapped_class

        return inner_wrapper

    @classmethod
    def register_parser(cls, name: str) -> Callable:

        def inner_wrapper(wrapped_class: type[Invoker]) -> type[Invoker]:
            cls._parsers[name] = wrapped_class
            return wrapped_class

        return inner_wrapper

    @classmethod
    def register_executor(cls, name: str) -> Callable:

        def inner_wrapper(wrapped_class: type[Invoker]) -> type[Invoker]:
            cls._executors[name] = wrapped_class
            return wrapped_class

        return inner_wrapper

    @classmethod
    def register_processor(cls, name: str) -> Callable:

        def inner_wrapper(wrapped_class: type[Invoker]) -> type[Invoker]:
            cls._processors[name] = wrapped_class
            return wrapped_class

        return inner_wrapper

    @classmethod
    def _get_name(
        cls,
        type: InvokerTypes,
        prompty: Prompty,
    ) -> str:
        if type == "renderer":
            return prompty.template.format
        elif type == "parser":
            return f"{prompty.template.parser}.{prompty.model.api}"
        elif type == "executor":
            return prompty.model.connection["type"]
        elif type == "processor":
            return prompty.model.connection["type"]
        else:
            raise ValueError(f"Type {type} not found")

    @classmethod
    def _get_invoker(
        cls,
        type: InvokerTypes,
        prompty: Prompty,
    ) -> Invoker:
        if type == "renderer":
            name = prompty.template.format
            if name not in cls._renderers:
                raise ValueError(f"Renderer {name} not found")

            return cls._renderers[name](prompty)

        elif type == "parser":
            name = f"{prompty.template.parser}.{prompty.model.api}"
            if name not in cls._parsers:
                raise ValueError(f"Parser {name} not found")

            return cls._parsers[name](prompty)

        elif type == "executor":
            name = prompty.model.connection["type"]
            if name not in cls._executors:
                raise ValueError(f"Executor {name} not found")

            return cls._executors[name](prompty)

        elif type == "processor":
            name = prompty.model.connection["type"]
            if name not in cls._processors:
                raise ValueError(f"Processor {name} not found")

            return cls._processors[name](prompty)

        else:
            raise ValueError(f"Type {type} not found")

    @classmethod
    def run(
        cls,
        type: InvokerTypes,
        prompty: Prompty,
        data: typing.Any,
        default: typing.Any = None,
    ):
        name = cls._get_name(type, prompty)
        if name.startswith("NOOP") and default is not None:
            return default
        elif name.startswith("NOOP"):
            return data

        invoker = cls._get_invoker(type, prompty)
        value = invoker.run(data)
        return value

    @classmethod
    async def run_async(
        cls,
        type: InvokerTypes,
        prompty: Prompty,
        data: typing.Any,
        default: typing.Any = None,
    ):
        name = cls._get_name(type, prompty)
        if name.startswith("NOOP") and default is not None:
            return default
        elif name.startswith("NOOP"):
            return data
        invoker = cls._get_invoker(type, prompty)
        value = await invoker.run_async(data)
        return value

    @classmethod
    def run_renderer(cls, prompty: Prompty, data: typing.Any, default: typing.Any = None) -> typing.Any:
        return cls.run("renderer", prompty, data, default)

    @classmethod
    async def run_renderer_async(cls, prompty: Prompty, data: typing.Any, default: typing.Any = None) -> typing.Any:
        return await cls.run_async("renderer", prompty, data, default)

    @classmethod
    def run_parser(cls, prompty: Prompty, data: typing.Any, default: typing.Any = None) -> typing.Any:
        return cls.run("parser", prompty, data, default)

    @classmethod
    async def run_parser_async(cls, prompty: Prompty, data: typing.Any, default: typing.Any = None) -> typing.Any:
        return await cls.run_async("parser", prompty, data, default)

    @classmethod
    def run_executor(cls, prompty: Prompty, data: typing.Any, default: typing.Any = None) -> typing.Any:
        return cls.run("executor", prompty, data, default)

    @classmethod
    async def run_executor_async(cls, prompty: Prompty, data: typing.Any, default: typing.Any = None) -> typing.Any:
        return await cls.run_async("executor", prompty, data, default)

    @classmethod
    def run_processor(cls, prompty: Prompty, data: typing.Any, default: typing.Any = None) -> typing.Any:
        return cls.run("processor", prompty, data, default)

    @classmethod
    async def run_processor_async(cls, prompty: Prompty, data: typing.Any, default: typing.Any = None) -> typing.Any:
        return await cls.run_async("processor", prompty, data, default)


class InvokerException(Exception):
    """Exception class for Invoker"""

    def __init__(self, message: str, type: str) -> None:
        super().__init__(message)
        self.type = type

    def __str__(self) -> str:
        return f"{super().__str__()}. Make sure to pip install any necessary package extras (i.e. could be something like `pip install prompty[{self.type}]`) for {self.type} as well as import the appropriate invokers (i.e. could be something like `import prompty.{self.type}`)."


@InvokerFactory.register_renderer("NOOP")
@InvokerFactory.register_parser("NOOP")
@InvokerFactory.register_executor("NOOP")
@InvokerFactory.register_processor("NOOP")
@InvokerFactory.register_parser("prompty.embedding")
@InvokerFactory.register_parser("prompty.image")
@InvokerFactory.register_parser("prompty.completion")
class NoOp(Invoker):
    def invoke(self, data: typing.Any) -> typing.Any:
        return data

    async def invoke_async(self, data: str) -> str:
        return self.invoke(data)
