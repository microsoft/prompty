using Microsoft.Extensions.AI;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Prompty.Core.Tests
{
    public class PrepareTests
    {
        public PrepareTests()
        {
            InvokerFactory.AutoDiscovery();
            Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", "ENDPOINT_VALUE");
        }

        [Theory]
        [InlineData("prompty/basic.prompty")]
        [InlineData("prompty/context.prompty")]
        [InlineData("prompty/functions.prompty")]
        public void Prepare(string path)
        {
            var prompty = Prompty.Load(path);
            var prepared = prompty.Prepare();
        }

        [Theory]
        [InlineData("prompty/basic.prompty")]
        [InlineData("prompty/context.prompty")]
        [InlineData("prompty/functions.prompty")]
        public void PrepareWithInput(string path)
        {
            var replacementText = "OTHER_TEXT_OTHER_TEXT";
            var prompty = Prompty.Load(path);
            var prepared = prompty.Prepare(new Dictionary<string, object>
            {
                { "question", replacementText }
            });

            Assert.IsType<ChatMessage[]>(prepared);
            var messages = (ChatMessage[])prepared;

            Assert.Equal(2, messages.Length);
            Assert.Equal(replacementText, messages[1].Text);
        }
    }
}
