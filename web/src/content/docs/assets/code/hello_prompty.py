import getpass
import os

if not os.environ.get("OPENAI_API_KEY"):
    os.environ["OPENAI_API_KEY"] = getpass.getpass("Enter API key for OpenAI: ")

from langchain.chat_models import init_chat_model
model = init_chat_model("gpt-4o-mini", model_provider="openai")

from pathlib import Path
folder = Path(__file__).parent.absolute().as_posix()

from langchain_prompty import create_chat_prompt
prompt = create_chat_prompt(folder + "/hello.prompty")

from langchain_core.output_parsers import StrOutputParser
parser = StrOutputParser()

chain = prompt | model | parser
response =chain.invoke({"input":'''{"question": "Tell me about your tents", "firstName": "Jane", "lastName": "Doe"}'''}) 
print(response)
