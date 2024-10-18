using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Prompty.Core.Parsers
{
    [Parser("prompty.chat")]
    public class PromptyChatParser : Invoker
    {
        public PromptyChatParser(Prompty prompty) : base(prompty) { }
        public override object Invoke(object args)
        {
            throw new NotImplementedException();
        }

        public override Task<object> InvokeAsync(object args)
        {
            throw new NotImplementedException();
        }
    }
}
