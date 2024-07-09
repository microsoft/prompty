from prompty import Invoker, Prompty, InvokerFactory


@InvokerFactory.register_renderer("fake")
@InvokerFactory.register_parser("fake.chat")
@InvokerFactory.register_executor("fake")
@InvokerFactory.register_processor("fake")
class FakeInvoker(Invoker):
    def __init__(self, prompty: Prompty) -> None:
        self.prompty = prompty

    def invoke(self, data: any) -> any:
        return data
