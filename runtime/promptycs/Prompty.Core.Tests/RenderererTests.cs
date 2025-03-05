namespace Prompty.Core.Tests
{

    public class RenderererTests
    {
        public RenderererTests()
        {
            InvokerFactory.AutoDiscovery();
            Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", "ENDPOINT_VALUE");
        }

        [Theory]
        [InlineData(["prompty/basic.prompty", "Jane Doe"])]
        [InlineData(["prompty/basic_mustache.prompty", "Jane Doe"])]
        [InlineData(["prompty/context.prompty", "Sally Davis"])]
        [InlineData(["prompty/groundedness.prompty", "Actual Task Output:"])]
        // [InlineData(["prompty/faithfulness.prompty", "The context used by the model"])]      // This prompty file is not working for renderer yet
        public void TestRenderer(string path, string expected)
        {
            var prompty = Prompty.Load(path);
            var invoker = InvokerFactory.Instance.CreateRenderer(prompty.Template!.Format, prompty);
            var result = invoker.Invoke(prompty.GetSample());

            Assert.True(((String)result).Length > 0);
            Assert.Contains(expected, (String)result);
        }

        [Theory]
        [InlineData(["prompty/basic.prompty", "Jane Doe"])]
        [InlineData(["prompty/basic_mustache.prompty", "Jane Doe"])]
        [InlineData(["prompty/context.prompty", "Sally Davis"])]
        [InlineData(["prompty/groundedness.prompty", "Actual Task Output:"])]
        // [InlineData(["prompty/faithfulness.prompty", "The context used by the model"])]      // This prompty file is not working for renderer yet
        public async Task TestRendererAsync(string path, string expected)
        {
            var prompty = Prompty.Load(path);
            var invoker = InvokerFactory.Instance.CreateRenderer(prompty.Template!.Format, prompty);
            var result = await invoker.InvokeAsync(prompty.GetSample());

            Assert.True(((String)result).Length > 0);
            Assert.Contains(expected, (String)result);
        }
    }
}

