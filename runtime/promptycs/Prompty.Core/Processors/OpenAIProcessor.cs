using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Azure;
using Azure.AI.OpenAI;
using Prompty.Core.Types;

namespace Prompty.Core.Processors
{
    public class OpenAIProcessor : IInvoker
    {
        public OpenAIProcessor(Prompty prompty, InvokerFactory invoker)
        {
            invoker.Register(InvokerType.Processor, ProcessorType.openai.ToString(), this);
            invoker.Register(InvokerType.Processor, ProcessorType.azure.ToString(), this);
        }

        public async Task<BaseModel> Invoke(BaseModel data)
        {
            //TODO: Implement OpenAIProcessor
            return data;
        }
                
    }
}