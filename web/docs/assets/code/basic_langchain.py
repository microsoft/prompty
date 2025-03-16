import getpass
import os
import json

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

# pip install langchain-prompty
from langchain_prompty import create_chat_prompt
from pathlib import Path

# load prompty as langchain ChatPromptTemplate
# Important Note: Langchain only support mustache templating. Add 
#  template: mustache
# to your prompty and use mustache syntax.
folder = Path(__file__).parent.absolute().as_posix()
path_to_prompty = folder + "/basic.prompty"
prompt = create_chat_prompt(path_to_prompty)

os.environ["OPENAI_API_KEY"] = getpass.getpass()
model = ChatOpenAI(model="gpt-4")


output_parser = StrOutputParser()

chain = prompt | model | output_parser

json_input = '''{
  "firstName": "Seth",
  "context": "The Alpine Explorer Tent boasts a detachable divider for privacy,  numerous mesh windows and adjustable vents for ventilation, and  a waterproof design. It even has a built-in gear loft for storing  your outdoor essentials. In short, it's a blend of privacy, comfort,  and convenience, making it your second home in the heart of nature!\\n",
  "question": "What can you tell me about your tents?"
}'''
args = json.loads(json_input)
result = chain.invoke(args)
print(result)
