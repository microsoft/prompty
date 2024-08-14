import azure.identity
import importlib.metadata
from typing import Iterator
from openai import AzureOpenAI
from ..core import Invoker, InvokerFactory, Prompty, PromptyStream

VERSION = importlib.metadata.version("prompty")


@InvokerFactory.register_executor("azure")
@InvokerFactory.register_executor("azure_openai")
class AzureOpenAIExecutor(Invoker):
    """Azure OpenAI Executor"""

    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)
        kwargs = {
            key: value
            for key, value in self.prompty.model.configuration.items()
            if key != "type"
        }

        # no key, use default credentials
        if "api_key" not in kwargs:
            # managed identity if client id
            if "client_id" in kwargs:
                default_credential = azure.identity.ManagedIdentityCredential(
                    client_id=kwargs.pop("client_id"),
                )
            # default credential
            else:
                default_credential = azure.identity.DefaultAzureCredential(
                    exclude_shared_token_cache_credential=True
                )

            kwargs["azure_ad_token_provider"] = (
                azure.identity.get_bearer_token_provider(
                    default_credential, "https://cognitiveservices.azure.com/.default"
                )
            )

        self.client = AzureOpenAI(
            default_headers={
                "User-Agent": f"prompty/{VERSION}",
                "x-ms-useragent": f"prompty/{VERSION}",
            },
            **kwargs,
        )

        self.api = self.prompty.model.api
        self.deployment = self.prompty.model.configuration["azure_deployment"]
        self.parameters = self.prompty.model.parameters

    def invoke(self, data: any) -> any:
        """Invoke the Azure OpenAI API

        Parameters
        ----------
        data : any
            The data to send to the Azure OpenAI API

        Returns
        -------
        any
            The response from the Azure OpenAI API
        """
        if self.api == "chat":
            response = self.client.chat.completions.create(
                model=self.deployment,
                messages=data if isinstance(data, list) else [data],
                **self.parameters,
            )

        elif self.api == "completion":
            response = self.client.completions.create(
                prompt=data.item,
                model=self.deployment,
                **self.parameters,
            )

        elif self.api == "embedding":
            response = self.client.embeddings.create(
                input=data if isinstance(data, list) else [data],
                model=self.deployment,
                **self.parameters,
            )

        elif self.api == "image":
            raise NotImplementedError("Azure OpenAI Image API is not implemented yet")

        # stream response
        if isinstance(response, Iterator):
            return PromptyStream("AzureOpenAIExecutor", response)
        else:
            return response
