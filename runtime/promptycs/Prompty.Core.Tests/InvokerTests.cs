using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Prompty.Core.Renderers;

namespace Prompty.Core.Tests
{
    [Executor("fake")]
    public class FakeInvoker: Invoker
    {
        public FakeInvoker(Prompty prompty) : base(prompty) { }
        public override object Invoke(object args)
        {
            return true;
        }

        public override Task<object> InvokeAsync(object args)
        {
            return Task.FromResult<object>(true);
        }
    }

    public class InvokerTests
    {
        public InvokerTests()
        {
            InvokerFactory.Instance.AutoRegister();
        }

        [Fact]
        public void AutoRegistrationTest()
        {
            Assert.True(InvokerFactory.Instance.IsRegistered("jinja2", InvokerType.Renderer));
            Assert.True(InvokerFactory.Instance.IsRegistered("liquid", InvokerType.Renderer));
            Assert.True(InvokerFactory.Instance.IsRegistered("NOOP", InvokerType.Renderer));
            Assert.True(InvokerFactory.Instance.IsRegistered("NOOP", InvokerType.Parser));
            Assert.True(InvokerFactory.Instance.IsRegistered("NOOP", InvokerType.Executor));
            Assert.True(InvokerFactory.Instance.IsRegistered("NOOP", InvokerType.Processor));
            Assert.True(InvokerFactory.Instance.IsRegistered("prompty.embedding", InvokerType.Parser));
            Assert.True(InvokerFactory.Instance.IsRegistered("prompty.image", InvokerType.Parser));
            Assert.True(InvokerFactory.Instance.IsRegistered("prompty.completion", InvokerType.Parser));
            Assert.True(InvokerFactory.Instance.IsRegistered("fake", InvokerType.Executor));
            Assert.True(InvokerFactory.Instance.IsRegistered("prompty.chat", InvokerType.Parser));
        }

        [Fact]
        public void CreationTest()
        {
            var invoker = InvokerFactory.Instance.CreateInvoker("jinja2", InvokerType.Renderer, new Prompty());
            Assert.NotNull(invoker);
            Assert.IsType<LiquidRenderer>(invoker);
        }

        [Fact]
        public void ExecutionTest()
        {
            var invoker = InvokerFactory.Instance.CreateInvoker("fake", InvokerType.Executor, new Prompty());
            var result = invoker.Invoke("test");
            Assert.True((bool)result);

            var resultAsync = invoker.InvokeAsync("test").Result;
            Assert.True((bool)resultAsync);


            Assert.True(invoker.Invoke<bool>("test"));
            Assert.True(invoker.InvokeAsync<bool>("test").Result);
        }

        [Fact]
        public void MissingInvokerTest()
        {
            Assert.Throws<Exception>(() => InvokerFactory.Instance.CreateInvoker("missing", InvokerType.Executor, new Prompty()));
        }

        [Fact]
        public void MissingInvokerTypeTest()
        {
            Assert.False(InvokerFactory.Instance.IsRegistered("missing", InvokerType.Executor));
        }

        [Fact]
        public void GetTest()
        {
            var invokerType = InvokerFactory.Instance.GetInvoker("jinja2", InvokerType.Renderer);
            Assert.NotNull(invokerType);
            Assert.Equal(typeof(LiquidRenderer), invokerType);
        }
    }
}
