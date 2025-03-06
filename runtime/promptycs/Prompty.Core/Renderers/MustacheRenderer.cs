using Stubble.Core.Builders;

namespace Prompty.Core.Renderers
{
    [Renderer("mustache")]
    public class MustacheRenderer : Invoker
    {
        public MustacheRenderer(Prompty prompty) : base(prompty) { }
        public override object Invoke(object args)
        {
            var stubble = new StubbleBuilder().Build();
            return stubble.Render(_prompty.Content.ToString(), args);
        }

        public override Task<object> InvokeAsync(object args)
        {
            return Task.FromResult(Invoke(args));
        }
    }
}
