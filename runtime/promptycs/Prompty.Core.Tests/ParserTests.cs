using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Prompty.Core.Tests
{

    public class ParserTests
    {
        public ParserTests()
        {
            InvokerFactory.Instance.AutoRegister();
            Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", "ENDPOINT_VALUE");
        }

        [Theory]
        [InlineData("generated/1contoso.md")]
        [InlineData("generated/2contoso.md")]
        [InlineData("generated/3contoso.md")]
        [InlineData("generated/4contoso.md")]
        [InlineData("generated/basic.prompty.md")]
        [InlineData("generated/context.prompty.md")]
        [InlineData("generated/contoso_multi.md")]
        [InlineData("generated/faithfulness.prompty.md")]
        [InlineData("generated/groundedness.prompty.md")]
        public void TestParser(string path)
        {
            // load text from file path
            var text = File.ReadAllText(path);
            var prompty = Prompty.Load("generated/basic.prompty");
            var invoker = InvokerFactory.Instance.CreateParser("prompty.chat", prompty);
            var result = invoker.Invoke(text);
        }
    }
}

