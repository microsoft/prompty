using Microsoft.Extensions.AI;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Prompty.Core.Tests
{
    class MyObject
    {
        public string question { get; set; } = string.Empty;
    }

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
            var prepared = prompty.Prepare(mergeSample: true);
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
            }, true);



            Assert.IsType<ChatMessage[]>(prepared);
            var messages = (ChatMessage[])prepared;

            Assert.Equal(2, messages.Length);
            Assert.Equal(replacementText, messages[1].Text);
        }

        [Theory]
        [InlineData("prompty/basic.prompty")]
        [InlineData("prompty/context.prompty")]
        [InlineData("prompty/functions.prompty")]
        public void PrepareWithObjectInput(string path)
        {
            var replacementText = "OTHER_TEXT_OTHER_TEXT";
            var prompty = Prompty.Load(path);
            var prepared = prompty.Prepare(new { question = replacementText }, true);



            Assert.IsType<ChatMessage[]>(prepared);
            var messages = (ChatMessage[])prepared;

            Assert.Equal(2, messages.Length);
            Assert.Equal(replacementText, messages[1].Text);
        }

        [Theory]
        [InlineData("prompty/basic.prompty")]
        [InlineData("prompty/context.prompty")]
        [InlineData("prompty/functions.prompty")]
        public void PrepareWithStrongObjectInput(string path)
        {

            var replacementText = new MyObject { question = "OTHER_TEXT_OTHER_TEXT" };
            var prompty = Prompty.Load(path);
            var prepared = prompty.Prepare(replacementText, true);



            Assert.IsType<ChatMessage[]>(prepared);
            var messages = (ChatMessage[])prepared;

            Assert.Equal(2, messages.Length);
            Assert.Equal(replacementText.question, messages[1].Text);
        }

    }
}
