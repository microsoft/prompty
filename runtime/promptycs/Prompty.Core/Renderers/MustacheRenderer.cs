using Stubble.Core.Builders;

namespace Prompty.Core.Renderers
{
    [Renderer("mustache")]
    public class MustacheRenderer(Prompty prompty) : Invoker(prompty)
    {
        public override object Invoke(object args)
        {
            _ = new StubbleBuilder().Build();
            return "";
        }

        public override Task<object> InvokeAsync(object args)
        {
            return Task.FromResult(Invoke(args));
        }
    }
}
