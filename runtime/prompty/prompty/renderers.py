import typing

from jinja2 import DictLoader, Environment

from .core import Prompty
from .invoker import Invoker


class Jinja2Renderer(Invoker):
    """Jinja2 Renderer"""

    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)
        self.templates = {}
        # generate template dictionary
        cur_prompt = self.prompty
        while cur_prompt:
            self.templates[cur_prompt.file.name] = cur_prompt.content
            cur_prompt = cur_prompt.basePrompty

        self.name = self.prompty.file.name

    def invoke(self, data: typing.Any) -> typing.Any:
        env = Environment(loader=DictLoader(self.templates))
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
