import json
import prompty
# to use the azure invoker make 
# sure to install prompty like this:
# pip install prompty[azure]
import prompty.azure
from prompty.tracer import trace, Tracer, console_tracer, PromptyTracer

# add console and json tracer:
# this only has to be done once
# at application startup
Tracer.add("console", console_tracer)
json_tracer = PromptyTracer()
Tracer.add("PromptyTracer", json_tracer.tracer)

# if your prompty file uses environment variables make
# sure they are loaded properly for correct execution
from dotenv import load_dotenv
load_dotenv()

@trace
def run(    
      question: any
) -> str:

  # execute the prompty file
  result = prompty.execute(
    "shakespeare.prompty", 
    inputs={
      "question": question
    }
  )

  return result

if __name__ == "__main__":
   json_input = '''{
  "question": "Can you create 5 different versions of a short message inviting friends to a Game Night?"
}'''
   args = json.loads(json_input)

   result = run(**args)
   print(result)
