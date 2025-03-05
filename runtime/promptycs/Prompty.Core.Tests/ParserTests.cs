using Microsoft.Extensions.AI;
using Prompty.Core.Parsers;

namespace Prompty.Core.Tests
{

    public class ParserTests
    {
        public ParserTests()
        {
            InvokerFactory.AutoDiscovery();
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

            Assert.NotNull(result);
            Assert.IsAssignableFrom<ChatMessage[]>(result);
            Assert.True(((ChatMessage[])result).Length > 0);
        }

        [Fact]
        public void TestParseWithArgs() 
        {
            var content = "system[key=\"value 1\", post=false, great=True, other=3.2, pre = 2]:\nYou are an AI assistant\n who helps people find information.\nAs the assistant, you answer questions briefly, succinctly.\n\nuser:\nWhat is the meaning of life?";
            var parser = new PromptyChatParser(new Prompty());
            var messages = parser.Parse(content).ToList();

            Assert.Equal(2, messages.Count());
            Assert.Equal("system", messages[0].Items["role"]);
            Assert.Equal("value 1", messages[0].Items["key"]);
            Assert.Equal(false, messages[0].Items["post"]);
            Assert.Equal(true, messages[0].Items["great"]);
            Assert.True((float)3.2 - (float)messages[0].Items["other"] < .001);
            Assert.Equal(2, messages[0].Items["pre"]);
            Assert.Equal("user", messages[1].Items["role"]);
        }
    }
}

