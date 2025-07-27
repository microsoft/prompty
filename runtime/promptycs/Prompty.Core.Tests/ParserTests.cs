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
        [InlineData("generated/contoso_multi_data_uri.md")]
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

        [Theory]
        [InlineData("system:\nYou are an AI assistant\n user:\nPlease tell me a joke.\nassistant:\nWhy did the chicken cross the road? To get to the other side!\nuser:\nTell me another one.\nassistant:\nWhy did the scarecrow win an award? Because he was outstanding in his field!")]
        [InlineData("You are an AI assistant\n user:\nPlease tell me a joke.\nassistant:\nWhy did the chicken cross the road? To get to the other side!\nuser:\nTell me another one.\nassistant:\nWhy did the scarecrow win an award? Because he was outstanding in his field!")]
        public void TestParseWithMultiTurn(string text)
        {
            var prompty = Prompty.Load("generated/basic.prompty");
            var invoker = InvokerFactory.Instance.CreateParser("prompty.chat", prompty);
            var messages = (ChatMessage[])invoker.Invoke(text);

            Assert.Equal(5, messages.Count());
            Assert.Equal(ChatRole.System, messages[0].Role);
            Assert.Equal("You are an AI assistant", ((TextContent)messages[0].Contents[0]).Text);
            Assert.Equal(ChatRole.User, messages[1].Role);
            Assert.Equal("Please tell me a joke.", ((TextContent)messages[1].Contents[0]).Text);
            Assert.Equal(ChatRole.Assistant, messages[2].Role);
            Assert.Equal("Why did the chicken cross the road? To get to the other side!", ((TextContent)messages[2].Contents[0]).Text);
            Assert.Equal(ChatRole.User, messages[3].Role);
            Assert.Equal("Tell me another one.", ((TextContent)messages[3].Contents[0]).Text);
            Assert.Equal(ChatRole.Assistant, messages[4].Role);
            Assert.Equal("Why did the scarecrow win an award? Because he was outstanding in his field!", ((TextContent)messages[4].Contents[0]).Text);
        }

        [Theory]
        [InlineData("system:\nYou are an AI assistant\n user:\nDescribe the contents of this image.\n![alt text dfdv](camping.jpg)")]
        [InlineData("system:\nYou are an AI assistant\n user:\nDescribe the contents of this image.\n![alt text dfdv](camping.jpg \"Title cds csd dsc\")")]
        [InlineData("system:\nYou are an AI assistant\n user:\nDescribe the contents of this image.\n![alt text dfdv](data:image/png;base64,bW9ja19iYXNlNjRfZGF0YQ==)")]
        [InlineData("system:\nYou are an AI assistant\n user:\nDescribe the contents of this image.\n![alt text dfdv](data:image/png;base64,bW9ja19iYXNlNjRfZGF0YQ== \"mock-title\")")]
        public void TestParseWithLocalImageOrDataURL(string text)
        {
            var prompty = Prompty.Load("generated/basic.prompty");
            var invoker = InvokerFactory.Instance.CreateParser("prompty.chat", prompty);
            var messages = (ChatMessage[])invoker.Invoke(text);

            Assert.Equal(2, messages.Count());
            Assert.Equal(ChatRole.System, messages[0].Role);
            Assert.Equal("You are an AI assistant", ((TextContent)messages[0].Contents[0]).Text);
            Assert.Equal(ChatRole.User, messages[1].Role);
            Assert.Equal("Describe the contents of this image.", ((TextContent)messages[1].Contents[0]).Text);
            Assert.True(messages[1].Contents[1] is DataContent);
            Assert.True(((DataContent)messages[1].Contents[1]).Uri.StartsWith("data:image/"));
        }

        [Theory]
        [InlineData("system:\nYou are an AI assistant\n user:\n![alt text dfdv](dummy-image.jpg)")]
        [InlineData("system:\nYou are an AI assistant\n user:\n![alt text dfdv](dummy-image.jpg \"Title cds csd dsc\")")]
        /// <summary>
        /// Either remote image or an invalid local image URL will be treated as a text content.
        /// </summary>
        public void TestParseWithRemoteOrInvalidImage(string text)
        {
            var prompty = Prompty.Load("generated/basic.prompty");
            var invoker = InvokerFactory.Instance.CreateParser("prompty.chat", prompty);
            var messages = (ChatMessage[])invoker.Invoke(text);

            Assert.Equal(2, messages.Count());
            Assert.Equal(ChatRole.System, messages[0].Role);
            Assert.Equal(ChatRole.User, messages[1].Role);
        }

        [Theory]
        [InlineData("system[key=\"value 1\", post=false, great=True, other=3.2, pre = 2]:\nYou are an AI assistant\nmock_line2.\nmock_lin3.\n\nuser:\nmock_question?")]
        [InlineData("system[key=\"value 1\", post=false, great=True, other=3.2, pre = 2]:\nYou are an AI assistant\nmock_line2.\nmock_lin3.\n\nuser:\nmock_question?\n![alt text dfdv](data:image/png;base64,bW9ja19iYXNlNjRfZGF0YQ==)")]
        [InlineData("system[key=\"value 1\", post=false, great=True, other=3.2, pre = 2]:\nYou are an AI assistant\nmock_line2.\nmock_lin3.\n\nuser:\nmock_question?\n![alt text dfdv](data:image/png;base64,bW9ja19iYXNlNjRfZGF0YQ== \"Title cds csd dsc\")")]
        public void TestParseWithArgs(string text)
        {
            var parser = new PromptyChatParser(new Prompty());
            var messages = parser.Parse(text).ToList();

            Assert.Equal(2, messages.Count());
            Assert.Equal(ChatRole.System, messages[0].Role);
            Assert.Equal("value 1", messages[0].Args["key"]);
            Assert.Equal(false, messages[0].Args["post"]);
            Assert.Equal(true, messages[0].Args["great"]);
            Assert.True((float)3.2 - (float)messages[0].Args["other"] < .001);
            Assert.Equal(2, messages[0].Args["pre"]);
            Assert.Equal(ChatRole.User, messages[1].Role);
        }
    }
}

