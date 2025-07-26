import typing
from pathlib import Path

from chevron import render
from jinja2 import DictLoader
from jinja2.sandbox import ImmutableSandboxedEnvironment

from .core import Prompty
from .invoker import Renderer


class Jinja2Renderer(Renderer):
    """Jinja2 Renderer"""

    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)
        self.templates: dict[str, str] = {}
        # generate template dictionary
        cur_prompt: typing.Union[Prompty, None] = self.prompty
        while cur_prompt:
            if isinstance(cur_prompt.file, str):
                cur_prompt.file = Path(cur_prompt.file).resolve().absolute()

            if isinstance(cur_prompt.template.content, str):
                self.templates[cur_prompt.file.name] = cur_prompt.template.content

            cur_prompt = cur_prompt.basePrompty

        if isinstance(self.prompty.file, str):
            self.prompty.file = Path(self.prompty.file).resolve().absolute()

        self.name = self.prompty.file.name

    def invoke(self, data: typing.Any) -> typing.Any:
        env = ImmutableSandboxedEnvironment(loader=DictLoader(self.templates))
        t = env.get_template(self.name)
        generated = t.render(**data)
        return generated

    async def invoke_async(self, data: str) -> str:
        """Invoke the Prompty Chat Parser (Async)

        Parameters
        ----------
        data : str
            The data to parse

        Returns
        -------
        str
            The parsed data
        """
        return self.invoke(data)


class MustacheRenderer(Renderer):
    """Render a mustache template."""

    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)
        self.templates = {}
        cur_prompt: typing.Union[Prompty, None] = self.prompty
        while cur_prompt:
            self.templates[Path(cur_prompt.file).name] = cur_prompt.content
            cur_prompt = cur_prompt.basePrompty
        self.name = Path(self.prompty.file).name

    def invoke(self, data: str) -> str:
        generated = render(self.prompty.content, data)  # type: ignore
        return generated

    async def invoke_async(self, data: str) -> str:
        """Invoke the Prompty Chat Parser (Async)

        Parameters
        ----------
        data : str
            The data to parse

        Returns
        -------
        str
            The parsed data
        """
        return self.invoke(data)
