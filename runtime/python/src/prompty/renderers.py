from pydantic import BaseModel
from .core import Invoker, InvokerFactory, Prompty
from jinja2 import DictLoader, Environment
import opentelemetry.trace as otel_trace


@InvokerFactory.register_renderer("jinja2")
class Jinja2Renderer(Invoker):
    def __init__(self, prompty: Prompty) -> None:
        self.prompty = prompty
        self.templates = {}
        # generate template dictionary
        cur_prompt = self.prompty
        while cur_prompt:
            self.templates[cur_prompt.file.name] = cur_prompt.content
            cur_prompt = cur_prompt.basePrompty

        self.name = self.prompty.file.name

    def invoke(self, data: any) -> any:
        otel_trace.get_current_span().update_name(f"Jinja2Renderer")
        env = Environment(loader=DictLoader(self.templates))
        t = env.get_template(self.name)
        generated = t.render(**data)
        return generated
